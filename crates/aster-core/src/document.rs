use std::path::Path;
use sha2::{Sha256, Digest};
use serde::{Serialize, Deserialize};
use crate::error::{AsterError, AsterResult};

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
pub struct DocContent {
    /// LF-normalised content (used for editing/display)
    pub content: String,
    /// SHA-256 of raw disk bytes
    pub hash: String,
    pub bom: Option<Bom>,
    pub line_ending: LineEnding,
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

        let text = String::from_utf8_lossy(body).into_owned();

        // Line ending detection and normalisation
        let line_ending = if text.contains("\r\n") { LineEnding::Crlf } else { LineEnding::Lf };
        let content = text.replace("\r\n", "\n");

        Ok(DocContent { content, hash, bom, line_ending })
    }

    /// Apply `edits` atomically. All edits are resolved first; any failure aborts the whole patch.
    pub fn patch(&self, path: &Path, edits: &[PatchEdit], expected_hash: Option<&str>) -> AsterResult<String> {
        let doc = self.read(path)?;

        // Conflict check
        if let Some(expected) = expected_hash {
            if doc.hash != expected {
                return Err(AsterError::Conflict {
                    expected: expected.to_owned(),
                    actual: doc.hash,
                });
            }
        }

        // Build line vec (each entry is the line without trailing \n, except we
        // keep things simple: split preserving empty last element if content ends \n)
        let lines: Vec<&str> = doc.content.split('\n').collect();
        // If content ends with \n the split produces a trailing empty string; drop it
        // for line-number math but remember whether to re-add it.
        let trailing_newline = doc.content.ends_with('\n');
        let effective: Vec<&str> = if trailing_newline && lines.last() == Some(&"") {
            lines[..lines.len() - 1].to_vec()
        } else {
            lines
        };
        let n = effective.len(); // number of "real" lines

        // Resolve all edits → list of (from_idx, to_idx_exclusive, replacement_lines)
        // Indices are 0-based into `effective`.
        struct Resolved {
            from: usize,    // inclusive, 0-based
            to: usize,      // exclusive, 0-based
            text: String,   // replacement text (may be multi-line, LF-normalised)
        }

        let mut resolved: Vec<Resolved> = Vec::with_capacity(edits.len());
        for edit in edits {
            match edit {
                PatchEdit::Range { range, text } => {
                    let s = range.start_line.saturating_sub(1); // to 0-based
                    let e = range.end_line; // exclusive 0-based
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
                // Strip trailing \n from text before splitting so we don't get a spurious empty line
                let t = r.text.trim_end_matches('\n');
                t.split('\n').map(|s| s.to_string()).collect()
            };
            result.splice(r.from..r.to, replacement);
        }

        let mut new_content = result.join("\n");
        if trailing_newline {
            new_content.push('\n');
        }

        self.write(path, &new_content, None)
    }

    pub fn hash_of(&self, path: &Path) -> AsterResult<String> {
        let raw = std::fs::read(path)?;
        Ok(sha256_hex(&raw))
    }

    /// `content` is LF-normalised.
    /// If `expected_hash` is Some, it is checked against the current on-disk hash (optimistic lock).
    /// Returns the new on-disk hash after a successful write.
    pub fn write(&self, path: &Path, content: &str, expected_hash: Option<&str>) -> AsterResult<String> {
        // Conflict check
        if let Some(expected) = expected_hash {
            if path.exists() {
                let actual = self.hash_of(path)?;
                if actual != expected {
                    return Err(AsterError::Conflict {
                        expected: expected.to_owned(),
                        actual,
                    });
                }
            }
        }

        // Restore BOM / line ending from existing file
        let (bom, line_ending) = if path.exists() {
            match self.read(path) {
                Ok(doc) => (doc.bom, doc.line_ending),
                Err(_)  => (None, LineEnding::Lf),
            }
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

        // Atomic write: tmp → fsync → rename
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("tmp");
        {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(&bytes)?;
            f.sync_all()?; // fsync: flush tmp to disk before rename
        }
        std::fs::rename(&tmp, path)?;

        Ok(sha256_hex(&bytes))
    }
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}
