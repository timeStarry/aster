use crate::error::{AsterError, AsterResult};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "__pycache__"];
const MD_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const MAX_SEARCH_FILE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTreeNode {
    pub name: String,
    pub path: String,
    pub rel_path: String,
    pub is_dir: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<WorkspaceTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchHit {
    pub path: String,
    pub rel_path: String,
    /// 1-based line number
    pub line: usize,
    /// 0-based character offset from the start of the document
    pub offset: usize,
    pub snippet: String,
}

pub struct WorkspaceService {
    root: Mutex<Option<PathBuf>>,
}

impl WorkspaceService {
    pub fn new() -> Self {
        Self {
            root: Mutex::new(None),
        }
    }

    pub fn open(&self, root: &Path) -> AsterResult<PathBuf> {
        if !root.is_dir() {
            return Err(AsterError::NotFound(root.display().to_string()));
        }
        let canon = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_owned());
        *self.root.lock().unwrap() = Some(canon.clone());
        Ok(canon)
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.root.lock().unwrap().clone()
    }

    fn require_root(&self) -> AsterResult<PathBuf> {
        self.root
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| AsterError::NotFound("workspace not open".into()))
    }

    /// Recursively list Markdown files (skips hidden and build directories), sorted deterministically.
    pub fn list(&self) -> AsterResult<Vec<PathBuf>> {
        let root = self.require_root()?;
        let mut results = Vec::new();
        collect_md(&root, &mut results)?;
        results.sort();
        Ok(results)
    }

    /// Build a pruned hierarchical directory tree containing Markdown documents.
    pub fn tree(&self) -> AsterResult<Vec<WorkspaceTreeNode>> {
        let root = self.require_root()?;
        build_tree(&root, &root, 0)
    }

    /// Full-text search across workspace Markdown files.
    pub fn search(
        &self,
        query: &str,
        case_sensitive: bool,
        max_results: usize,
    ) -> AsterResult<Vec<WorkspaceSearchHit>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let root = self.require_root()?;
        let files = self.list()?;
        let limit = max_results.clamp(1, 500);
        let needle = if case_sensitive {
            trimmed.to_owned()
        } else {
            trimmed.to_lowercase()
        };

        let mut hits = Vec::new();
        for file in files {
            if hits.len() >= limit {
                break;
            }
            let Ok(meta) = std::fs::metadata(&file) else {
                continue;
            };
            if meta.len() > MAX_SEARCH_FILE_BYTES {
                continue;
            }
            let Ok(bytes) = std::fs::read(&file) else {
                continue;
            };
            let Ok(text) = std::str::from_utf8(&bytes) else {
                continue;
            };

            let rel_path = file
                .strip_prefix(&root)
                .unwrap_or(&file)
                .to_string_lossy()
                .replace('\\', "/");
            let full_path = file.to_string_lossy().into_owned();

            let mut char_offset = 0usize;
            for (idx, raw_line) in text.split('\n').enumerate() {
                let line_clean = raw_line.strip_suffix('\r').unwrap_or(raw_line);
                let matched_char_col = if case_sensitive {
                    line_clean.find(&needle).map(|b| line_clean[..b].chars().count())
                } else {
                    line_clean
                        .to_lowercase()
                        .find(&needle)
                        .map(|_| {
                            // Map approximately in original line by scanning char slices if non-ASCII case fold differs
                            find_char_col_case_insensitive(line_clean, &needle).unwrap_or(0)
                        })
                };

                if let Some(col_chars) = matched_char_col {
                    hits.push(WorkspaceSearchHit {
                        path: full_path.clone(),
                        rel_path: rel_path.clone(),
                        line: idx + 1,
                        offset: char_offset + col_chars,
                        snippet: make_snippet(line_clean, col_chars, 120),
                    });
                    if hits.len() >= limit {
                        break;
                    }
                }
                // Advance UTF-16/char offset (+1 for '\n')
                char_offset += raw_line.chars().count() + 1;
            }
        }
        Ok(hits)
    }

    /// Create a new Markdown file under the open workspace root safely.
    pub fn create_file(&self, rel_path: &str) -> AsterResult<PathBuf> {
        let root = self.require_root()?;
        let cleaned = rel_path.trim().trim_start_matches(['/', '\\']);
        if cleaned.is_empty() {
            return Err(AsterError::InvalidParams("file name cannot be empty".into()));
        }

        let candidate_rel = Path::new(cleaned);
        for comp in candidate_rel.components() {
            match comp {
                Component::Normal(_) | Component::CurDir => {}
                _ => {
                    return Err(AsterError::InvalidParams(
                        "relative path must stay within workspace".into(),
                    ))
                }
            }
        }

        let mut target = root.join(candidate_rel);
        if target.extension().is_none() {
            target.set_extension("md");
        }
        if target.exists() {
            return Err(AsterError::InvalidParams(format!(
                "file already exists: {}",
                target.display()
            )));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&target, "")?;
        Ok(target)
    }
}

fn find_char_col_case_insensitive(line: &str, lower_needle: &str) -> Option<usize> {
    for (char_idx, (byte_idx, _)) in line.char_indices().enumerate() {
        if line[byte_idx..].to_lowercase().starts_with(lower_needle) {
            return Some(char_idx);
        }
    }
    None
}

fn make_snippet(line: &str, match_col: usize, max_chars: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= max_chars {
        return line.trim().to_owned();
    }
    let half = max_chars / 2;
    let start = match_col.saturating_sub(half).min(chars.len().saturating_sub(max_chars));
    let end = (start + max_chars).min(chars.len());
    let mut out: String = chars[start..end].iter().collect();
    out = out.trim().to_owned();
    if start > 0 {
        out = format!("…{out}");
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| MD_EXTENSIONS.iter().any(|m| ext.eq_ignore_ascii_case(m)))
        .unwrap_or(false)
}

fn should_skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

fn collect_md(dir: &Path, out: &mut Vec<PathBuf>) -> AsterResult<()> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if path.is_dir() {
            if !should_skip_dir(name) {
                collect_md(&path, out)?;
            }
        } else if is_markdown_file(&path) {
            out.push(path);
        }
    }
    Ok(())
}

fn build_tree(root: &Path, dir: &Path, depth: usize) -> AsterResult<Vec<WorkspaceTreeNode>> {
    if depth > 12 {
        return Ok(Vec::new());
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(Vec::new());
    };

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();
        if name.is_empty() {
            continue;
        }
        let rel_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        if path.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            let children = build_tree(root, &path, depth + 1)?;
            if !children.is_empty() {
                dirs.push(WorkspaceTreeNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    rel_path,
                    is_dir: true,
                    children,
                });
            }
        } else if is_markdown_file(&path) {
            files.push(WorkspaceTreeNode {
                name,
                path: path.to_string_lossy().into_owned(),
                rel_path,
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    Ok(dirs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_search_and_create_file_work_safely() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("docs/guides")).unwrap();
        std::fs::create_dir_all(tmp.path().join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(tmp.path().join("empty_dir")).unwrap();

        std::fs::write(tmp.path().join("README.md"), "# Aster Overview\nZero-jank Live Preview").unwrap();
        std::fs::write(tmp.path().join("docs/guides/intro.markdown"), "欢迎使用 Aster 编辑器").unwrap();
        std::fs::write(tmp.path().join("node_modules/pkg/README.md"), "ignored").unwrap();

        let ws = WorkspaceService::new();
        ws.open(tmp.path()).unwrap();

        let list = ws.list().unwrap();
        assert_eq!(list.len(), 2);

        let tree = ws.tree().unwrap();
        assert_eq!(tree.len(), 2); // `docs` folder first, then `README.md` (`empty_dir` & `node_modules` pruned!)
        assert!(tree[0].is_dir);
        assert_eq!(tree[0].name, "docs");
        assert_eq!(tree[1].name, "README.md");

        let hits = ws.search("live preview", false, 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].rel_path, "README.md");
        assert_eq!(hits[0].line, 2);

        let cjk_hits = ws.search("编辑器", false, 50).unwrap();
        assert_eq!(cjk_hits.len(), 1);
        assert_eq!(cjk_hits[0].rel_path, "docs/guides/intro.markdown");

        // Safe create file (auto-appends .md, blocks traversal)
        assert!(ws.create_file("../escape.md").is_err());
        let created = ws.create_file("notes/daily").unwrap();
        assert!(created.ends_with("notes/daily.md"));
        assert!(created.exists());
        assert!(ws.create_file("notes/daily.md").is_err());
    }
}
