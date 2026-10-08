use std::path::{Path, PathBuf};

/// Returns the recovery directory: ~/.aster/recovery/
pub fn recovery_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("recovery")
}

/// Write a recovery copy of `content` for `doc_path` to disk (atomic).
/// Called from an async context; errors are silently discarded — recovery is best-effort.
pub async fn write_recovery(doc_path: &Path, content: &str) {
    let dir = recovery_dir();
    if tokio::fs::create_dir_all(&dir).await.is_err() { return; }

    let name = doc_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled");
    let recovery_path = dir.join(format!("{}.recovery", name));
    let tmp = recovery_path.with_extension("tmp");

    if tokio::fs::write(&tmp, content.as_bytes()).await.is_ok() {
        let _ = tokio::fs::rename(&tmp, &recovery_path).await;
    }
}

/// Remove the recovery file for `doc_path` after a clean save.
pub async fn remove_recovery(doc_path: &Path) {
    let name = doc_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled");
    let recovery_path = recovery_dir().join(format!("{}.recovery", name));
    let _ = tokio::fs::remove_file(&recovery_path).await;
}
