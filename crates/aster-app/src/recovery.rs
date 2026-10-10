//! Crash recovery for unsaved work.
//!
//! The frontend writes a snapshot of every tab that holds unsaved changes
//! (new documents, and edited files that haven't been saved). A clean exit
//! clears it, so a snapshot that is still there on startup means the last
//! session ended abruptly and offers what can be restored.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const MAX_BYTES: usize = 64 * 1024 * 1024;

fn session_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".aster").join("session")
}

fn snapshot_path() -> PathBuf {
    session_dir().join("unsaved.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnsavedTab {
    pub title: String,
    /// None for documents that were never saved.
    pub path: Option<String>,
    pub content: String,
    /// Hash of the file when it was last loaded/saved (edited files only).
    #[serde(default)]
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: u32,
    /// Unix time in milliseconds when the snapshot was taken.
    pub saved_at: u64,
    pub tabs: Vec<UnsavedTab>,
}

fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path)
}

/// Replace the snapshot; an empty list removes it.
pub fn save(snapshot: &Snapshot) -> std::io::Result<()> {
    if snapshot.tabs.is_empty() {
        return clear();
    }
    let bytes = serde_json::to_vec(snapshot).map_err(std::io::Error::other)?;
    if bytes.len() > MAX_BYTES {
        return Err(std::io::Error::other("snapshot too large"));
    }
    write_atomic(&snapshot_path(), &bytes)
}

pub fn load() -> Option<Snapshot> {
    let bytes = std::fs::read(snapshot_path()).ok()?;
    if bytes.len() > MAX_BYTES {
        return None;
    }
    serde_json::from_slice::<Snapshot>(&bytes).ok().filter(|s| !s.tabs.is_empty())
}

pub fn clear() -> std::io::Result<()> {
    match std::fs::remove_file(snapshot_path()) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn session_save(snapshot: Snapshot) -> Result<(), String> {
    save(&snapshot).map_err(|e| e.to_string())
}

/// Called once at startup. Returns the previous session's unsaved tabs, if any.
#[tauri::command]
pub fn session_take() -> Option<Snapshot> {
    load()
}

#[tauri::command]
pub fn session_clear() -> Result<(), String> {
    clear().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_round_trips_through_json() {
        let s = Snapshot {
            version: 1,
            saved_at: 1,
            tabs: vec![UnsavedTab { title: "未命名".into(), path: None, content: "# hi".into(), hash: None }],
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("savedAt"));
        assert_eq!(serde_json::from_str::<Snapshot>(&json).unwrap(), s);
    }

    #[test]
    fn write_atomic_replaces_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a/b/unsaved.json");
        write_atomic(&p, b"one").unwrap();
        write_atomic(&p, b"two").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"two");
        assert!(!p.with_extension("tmp").exists());
    }
}
