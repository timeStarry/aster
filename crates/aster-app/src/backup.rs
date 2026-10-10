//! Reading and writing settings backup files chosen through the native dialog.
//!
//! Restricted to `.json` files under 1 MiB: the webview only ever needs these
//! two operations for settings, so it doesn't get a general file API here.

use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 1024 * 1024;

fn check_ext(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(e) if e.eq_ignore_ascii_case("json") => Ok(()),
        _ => Err("settings files must have a .json extension".into()),
    }
}

#[tauri::command]
pub fn settings_file_write(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    check_ext(&path)?;
    if contents.len() as u64 > MAX_BYTES {
        return Err("settings file is too large".into());
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
pub fn settings_file_read(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    check_ext(&path)?;
    let len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > MAX_BYTES {
        return Err("settings file is too large".into());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_other_extensions() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("s.json").to_string_lossy().into_owned();
        settings_file_write(p.clone(), "{\"a\":1}".into()).unwrap();
        assert_eq!(settings_file_read(p).unwrap(), "{\"a\":1}");
        let bad = dir.path().join("s.md").to_string_lossy().into_owned();
        assert!(settings_file_write(bad.clone(), "x".into()).is_err());
        assert!(settings_file_read(bad).is_err());
    }
}
