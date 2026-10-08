use std::path::{Path, PathBuf};
use std::sync::Mutex;
use crate::error::{AsterError, AsterResult};

pub struct WorkspaceService {
    root: Mutex<Option<PathBuf>>,
}

impl WorkspaceService {
    pub fn new() -> Self {
        Self { root: Mutex::new(None) }
    }

    pub fn open(&self, root: &Path) -> AsterResult<()> {
        if !root.is_dir() {
            return Err(AsterError::NotFound(root.display().to_string()));
        }
        *self.root.lock().unwrap() = Some(root.to_owned());
        Ok(())
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.root.lock().unwrap().clone()
    }

    /// Recursively list Markdown files (skips hidden dirs).
    pub fn list(&self) -> AsterResult<Vec<PathBuf>> {
        let root = self.root.lock().unwrap().clone()
            .ok_or_else(|| AsterError::NotFound("workspace not open".into()))?;
        let mut results = Vec::new();
        collect_md(&root, &mut results)?;
        Ok(results)
    }
}

fn collect_md(dir: &Path, out: &mut Vec<PathBuf>) -> AsterResult<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') { continue; }
        if path.is_dir() {
            collect_md(&path, out)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            out.push(path);
        }
    }
    Ok(())
}
