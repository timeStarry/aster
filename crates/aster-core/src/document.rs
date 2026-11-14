use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use sha2::{Sha256, Digest};
use serde::{Serialize, Deserialize};
use crate::error::{AsterError, AsterResult};

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generate a hidden, collision-free sibling temp path: `.{name}.aster-{pid}-{seq}.tmp`.
pub fn atomic_temp_path(path: &Path) -> PathBuf {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document");
    let seq = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    parent.join(format!(".{name}.aster-{pid}-{seq}.tmp"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchPosition { Before, After, Replace }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub find: String,
    #[serde(default = "default_occurrence")]
    pub occurrence: usize,
    pub position: PatchPosition,
}
fn default_occurrence() -> usize { 1 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PatchEdit {
    Range { range: LineRange, text: String },
    Anchor { anchor: Anchor, text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineEnding { Lf, Crlf }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Bom { Utf8 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocContent {
    /// LF-normalised content (used for editing/display)
    pub content: String,
    /// SHA-256 of raw disk bytes
    pub hash: String,
    pub bom: Option<Bom>,
    pub line_ending: LineEnding,
    /// True when the file cannot be safely edited (e.g. non-UTF-8 encoding).
    #[serde(default)]
    pub read_only: bool,
    /// True when raw bytes were not valid UTF-8 and replacement characters were substituted for preview.
    #[serde(default)]
    pub encoding_lossy: bool,
}

fn decode_strict_utf8<'a>(raw: &'a [u8], body: &'a [u8]) -> Option<&'a str> {
    // Reject UTF-16 LE/BE BOMs and binary/UTF-16 NUL bytes before UTF-8 decoding.
    if raw.starts_with(&[0xFF, 0xFE]) || raw.starts_with(&[0xFE, 0xFF]) || body.contains(&0) {
        return None;
    }
    std::str::from_utf8(body).ok()
}

pub struct DocumentService;

impl DocumentService {
    pub fn new() -> Self { Self }

    pub fn read(&self, path: &Path) -> AsterResult<DocContent> {
        let raw = std::fs::read(path)
            .map_err(|_| AsterError::NotFound(path.display().to_string()))?;
        let hash = sha256_hex(&raw);

        // BOM detection
        let (bom, body) = if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
            (Some(Bom::Utf8), &raw[3..])
        } else {
            (None, raw.as_slice())
        };

        let (text, encoding_lossy, read_only) = match decode_strict_utf8(&raw, body) {
            Some(valid) => (valid.to_owned(), false, false),
            None => (String::from_utf8_lossy(body).into_owned(), true, true),
        };

        // Line ending detection and normalisation
        let line_ending = if text.contains("\r\n") { LineEnding::Crlf } else { LineEnding::Lf };
        let content = text.replace("\r\n", "\n");

        Ok(DocContent {
            content,
            hash,
            bom,
            line_ending,
            read_only,
            encoding_lossy,
        })
    }

    /// Apply `edits` atomically. All edits are resolved first; any failure aborts the whole patch.
    pub fn patch(&self, path: &Path, edits: &[PatchEdit], expected_hash: Option<&str>) -> AsterResult<String> {
        let doc = self.read(path)?;
        if doc.encoding_lossy {
            return Err(AsterError::InvalidEncoding(format!(
                "refusing to patch non-UTF-8 file: {}",
                path.display()
            )));
        }

        // Conflict check
        if let Some(expected) = expected_hash {
            if doc.hash != expected {
                return Err(AsterError::Conflict {
                    expected: expected.to_owned(),
                    actual: doc.hash,
                });
            }
        }

        let lines: Vec<&str> = doc.content.split('\n').collect();
        let trailing_newline = doc.content.ends_with('\n');
        let effective: Vec<&str> = if trailing_newline && lines.last() == Some(&"") {
            lines[..lines.len() - 1].to_vec()
        } else {
            lines
        };
        let n = effective.len();

        struct Resolved {
            from: usize,
            to: usize,
            text: String,
        }

        let mut resolved: Vec<Resolved> = Vec::with_capacity(edits.len());
        for edit in edits {
            match edit {
                PatchEdit::Range { range, text } => {
                    let s = range.start_line.saturating_sub(1);
                    let e = range.end_line;
                    if range.start_line == 0 || range.start_line > n + 1 {
                        return Err(AsterError::AnchorNotFound(
                            format!("line {} out of range (file has {} lines)", range.start_line, n)
                        ));
                    }
                    resolved.push(Resolved { from: s, to: e.min(n), text: text.clone() });
                }
                PatchEdit::Anchor { anchor, text } => {
                    let mut count = 0usize;
                    let mut found = None;
                    for (i, line) in effective.iter().enumerate() {
                        if line.contains(anchor.find.as_str()) {
                            count += 1;
                            if count == anchor.occurrence {
                                found = Some(i);
                                break;
                            }
                        }
                    }
                    let idx = found.ok_or_else(|| AsterError::AnchorNotFound(
                        format!("\"{}\" (occurrence {}) not found", anchor.find, anchor.occurrence)
                    ))?;
                    match anchor.position {
                        PatchPosition::Before => resolved.push(Resolved { from: idx, to: idx, text: text.clone() }),
                        PatchPosition::After  => resolved.push(Resolved { from: idx + 1, to: idx + 1, text: text.clone() }),
                        PatchPosition::Replace => resolved.push(Resolved { from: idx, to: idx + 1, text: text.clone() }),
                    }
                }
            }
        }

        // Apply in reverse order so line indices don't shift
        resolved.sort_by(|a, b| b.from.cmp(&a.from));

        let mut result: Vec<String> = effective.iter().map(|s| s.to_string()).collect();
        for r in resolved {
            let replacement: Vec<String> = if r.text.is_empty() {
                vec![]
            } else {
                let t = r.text.trim_end_matches('\n');
                t.split('\n').map(|s| s.to_string()).collect()
            };
            result.splice(r.from..r.to, replacement);
        }

        let mut new_content = result.join("\n");
        if trailing_newline {
            new_content.push('\n');
        }

        self.write(path, &new_content, Some(&doc.hash))
    }

    pub fn hash_of(&self, path: &Path) -> AsterResult<String> {
        let raw = std::fs::read(path)?;
        Ok(sha256_hex(&raw))
    }

    /// `content` is LF-normalised.
    /// If `expected_hash` is Some, it is checked against the current on-disk hash (optimistic lock).
    /// Refuses to overwrite existing non-UTF-8 files to prevent silent encoding corruption.
    /// Returns the new on-disk hash after a successful write.
    pub fn write(&self, path: &Path, content: &str, expected_hash: Option<&str>) -> AsterResult<String> {
        let (bom, line_ending) = if path.exists() {
            let existing = self.read(path)?;
            if existing.encoding_lossy {
                return Err(AsterError::InvalidEncoding(format!(
                    "refusing to overwrite non-UTF-8 file: {}",
                    path.display()
                )));
            }
            if let Some(expected) = expected_hash {
                if existing.hash != expected {
                    return Err(AsterError::Conflict {
                        expected: expected.to_owned(),
                        actual: existing.hash,
                    });
                }
            }
            (existing.bom, existing.line_ending)
        } else {
            (None, LineEnding::Lf)
        };

        // LF → original line ending
        let body = match line_ending {
            LineEnding::Lf   => content.to_owned(),
            LineEnding::Crlf => content.replace('\n', "\r\n"),
        };

        let mut bytes: Vec<u8> = Vec::new();
        if bom == Some(Bom::Utf8) {
            bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        bytes.extend_from_slice(body.as_bytes());

        // Atomic write: hidden unique tmp → fsync → rename
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = atomic_temp_path(path);
        {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp)?;
            if let Err(e) = f.write_all(&bytes).and_then(|_| f.sync_all()) {
                let _ = std::fs::remove_file(&tmp);
                return Err(AsterError::Io(e.to_string()));
            }
        }
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(AsterError::Io(e.to_string()));
        }

        Ok(sha256_hex(&bytes))
    }
}

impl Default for DocumentService {
    fn default() -> Self { Self::new() }
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}
