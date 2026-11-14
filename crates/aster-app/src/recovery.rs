//! Session persistence, Hot Exit, and Silent Draft storage (`~/.aster/drafts/`).
//!
//! - Untitled drafts persist continuously to `~/.aster/drafts/<draft-id>/content.md`
//!   so normal quits (`⌘Q` / window close) never nag with save dialogs.
//! - `~/.aster/session/session.json` records all open tabs (file paths + draft IDs),
//!   active tab, cursor offsets, and scroll positions so restarting Aster restores
//!   the exact workspace state seamlessly.

use aster_core::document::atomic_temp_path;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_BYTES: usize = 64 * 1024 * 1024;

fn aster_root_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ASTER_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
}

fn session_dir() -> PathBuf {
    aster_root_dir().join("session")
}

fn session_path() -> PathBuf {
    session_dir().join("session.json")
}

fn snapshot_path() -> PathBuf {
    session_dir().join("unsaved.json")
}

pub fn drafts_root_dir() -> PathBuf {
    aster_root_dir().join("drafts")
}

fn valid_draft_id(id: &str) -> Result<&str, String> {
    if id.is_empty() || id.len() > 64 {
        return Err("invalid draft id length".into());
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid characters in draft id".into());
    }
    Ok(id)
}

pub fn draft_dir_for(id: &str) -> Result<PathBuf, String> {
    let valid = valid_draft_id(id)?;
    Ok(drafts_root_dir().join(valid))
}

// ── Legacy v1 types (kept for migration & backwards compatibility) ───────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnsavedTab {
    pub title: String,
    pub path: Option<String>,
    pub content: String,
    #[serde(default)]
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: u32,
    pub saved_at: u64,
    pub tabs: Vec<UnsavedTab>,
}

// ── v2 Session & Silent Draft types ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub id: String,
    pub title: String,
    /// File path on disk, or None for an untitled draft.
    pub path: Option<String>,
    /// Stable draft folder id under `~/.aster/drafts/<draft_id>/` for untitled buffers.
    #[serde(default)]
    pub draft_id: Option<String>,
    #[serde(default)]
    pub cursor: usize,
    #[serde(default)]
    pub scroll_top: f64,
    /// Populated only when a file-backed tab has unsaved edits (e.g. autoSave disabled or conflict).
    #[serde(default)]
    pub unsaved_content: Option<String>,
    #[serde(default)]
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub version: u32,
    pub saved_at: u64,
    #[serde(default)]
    pub clean_exit: bool,
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub workspace_root: Option<String>,
    pub tabs: Vec<SessionTab>,
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = atomic_temp_path(path);
    if let Err(e) = std::fs::write(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

// ── Draft CRUD ───────────────────────────────────────────────────────────────

pub fn save_draft(draft_id: &str, content: &str) -> Result<PathBuf, String> {
    if content.len() > MAX_BYTES {
        return Err("draft too large".into());
    }
    let dir = draft_dir_for(draft_id)?;
    let file = dir.join("content.md");
    write_atomic(&file, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn read_draft(draft_id: &str) -> Result<Option<String>, String> {
    let dir = draft_dir_for(draft_id)?;
    let file = dir.join("content.md");
    if !file.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("draft too large".into());
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

pub fn delete_draft(draft_id: &str) -> Result<(), String> {
    let dir = draft_dir_for(draft_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── v2 Session Store ─────────────────────────────────────────────────────────

pub fn save_session_state(session: &SessionState) -> std::io::Result<()> {
    let bytes = serde_json::to_vec_pretty(session).map_err(std::io::Error::other)?;
    if bytes.len() > MAX_BYTES {
        return Err(std::io::Error::other("session too large"));
    }
    write_atomic(&session_path(), &bytes)?;
    // Clean up legacy v1 snapshot file if present so old recovery doesn't re-trigger.
    let _ = clear();
    Ok(())
}

pub fn load_session_state() -> Option<SessionState> {
    let p = session_path();
    if let Ok(bytes) = std::fs::read(&p) {
        if bytes.len() <= MAX_BYTES {
            if let Ok(state) = serde_json::from_slice::<SessionState>(&bytes) {
                return Some(state);
            }
        }
    }
    // Migrate legacy v1 `unsaved.json` transparently if found
    let legacy = load()?;
    let tabs = legacy
        .tabs
        .into_iter()
        .enumerate()
        .map(|(i, t)| {
            let id = format!("migrated-{i}");
            let draft_id = if t.path.is_none() {
                let did = format!("draft-migrated-{i}");
                let _ = save_draft(&did, &t.content);
                Some(did)
            } else {
                None
            };
            SessionTab {
                id,
                title: t.title,
                path: t.path.clone(),
                draft_id,
                cursor: 0,
                scroll_top: 0.0,
                unsaved_content: if t.path.is_some() { Some(t.content) } else { None },
                hash: t.hash,
            }
        })
        .collect();
    Some(SessionState {
        version: 2,
        saved_at: legacy.saved_at,
        clean_exit: false,
        active_id: None,
        workspace_root: None,
        tabs,
    })
}

// ── Legacy v1 functions ──────────────────────────────────────────────────────

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

// ── Tauri IPC commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn draft_save(draft_id: String, content: String, app: tauri::AppHandle) -> Result<String, String> {
    let dir = save_draft(&draft_id, &content)?;
    if let Ok(canon) = std::fs::canonicalize(&dir) {
        use tauri::Manager;
        let _ = app.asset_protocol_scope().allow_directory(&canon, true);
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn draft_read(draft_id: String, app: tauri::AppHandle) -> Result<Option<String>, String> {
    let content = read_draft(&draft_id)?;
    if content.is_some() {
        if let Ok(dir) = draft_dir_for(&draft_id).and_then(|d| std::fs::canonicalize(d).map_err(|e| e.to_string())) {
            use tauri::Manager;
            let _ = app.asset_protocol_scope().allow_directory(&dir, true);
        }
    }
    Ok(content)
}

#[tauri::command]
pub fn draft_delete(draft_id: String) -> Result<(), String> {
    delete_draft(&draft_id)
}

#[tauri::command]
pub fn session_save_v2(session: SessionState) -> Result<(), String> {
    save_session_state(&session).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_load_v2() -> Option<SessionState> {
    load_session_state()
}

#[tauri::command]
pub fn session_save(snapshot: Snapshot) -> Result<(), String> {
    save(&snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_take() -> Option<Snapshot> {
    load()
}

#[tauri::command]
pub fn session_clear() -> Result<(), String> {
    clear().map_err(|e| e.to_string())
}

#[cfg(test)]
pub(crate) static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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

    #[test]
    fn draft_crud_and_path_traversal_guard() {
        assert!(draft_dir_for("../escape").is_err());
        assert!(draft_dir_for("a/b").is_err());
        assert!(draft_dir_for("").is_err());

        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("ASTER_CONFIG_DIR", dir.path());
        save_draft("draft-123", "# Silent Draft\n").unwrap();
        assert_eq!(read_draft("draft-123").unwrap().as_deref(), Some("# Silent Draft\n"));

        let session = SessionState {
            version: 2,
            saved_at: 42,
            clean_exit: true,
            active_id: Some("t1".into()),
            workspace_root: None,
            tabs: vec![SessionTab {
                id: "t1".into(),
                title: "Untitled".into(),
                path: None,
                draft_id: Some("draft-123".into()),
                cursor: 12,
                scroll_top: 180.0,
                unsaved_content: None,
                hash: None,
            }],
        };
        save_session_state(&session).unwrap();
        let loaded = load_session_state().unwrap();
        assert_eq!(loaded, session);

        delete_draft("draft-123").unwrap();
        assert_eq!(read_draft("draft-123").unwrap(), None);
        std::env::remove_var("ASTER_CONFIG_DIR");
    }
}
