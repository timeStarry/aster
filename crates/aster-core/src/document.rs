use std::path::Path;
use sha2::{Sha256, Digest};
use serde::{Serialize, Deserialize};
use crate::error::{AsterError, AsterResult};

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
