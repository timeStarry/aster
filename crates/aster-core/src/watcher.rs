//! File-system watcher for open documents, deduplicated by SHA-256 content hash.
//!
//! Watches parent directories (`RecursiveMode::NonRecursive`) rather than file inodes
//! directly so atomic `tmp -> rename` writes from Git, Claude Code, Vim, or `aster patch`
//! are always detected across macOS FSEvents, Windows ReadDirectoryChangesW, and Linux inotify.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use crate::document::DocumentService;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// Original path as opened by the caller (so frontend tab matching is exact).
    pub path: String,
    pub content: String,
    pub hash: String,
}

struct WatchedEntry {
    /// Original path string supplied by the UI when opening/saving the tab.
    display_path: String,
    /// Canonical parent directory being watched.
    parent_dir: PathBuf,
    /// Last hash written or acknowledged by Aster; matching disk hashes are ignored.
    known_hash: String,
}

struct Inner {
    /// Keyed by canonical file path (`canonical_parent.join(file_name)`).
    files: HashMap<PathBuf, WatchedEntry>,
    /// Ref-count of watched files per canonical parent directory.
    dir_refs: HashMap<PathBuf, usize>,
    watcher: Option<RecommendedWatcher>,
}

/// Normalize a file path by canonicalizing its parent directory and joining its filename.
/// Handles macOS `/var` -> `/private/var` symlinks even before or during atomic renames.
fn normalize_file_path(path: &Path) -> Option<(PathBuf, PathBuf)> {
    let name = path.file_name()?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let canon_parent = std::fs::canonicalize(parent).ok()?;
    let full = canon_parent.join(name);
    Some((canon_parent, full))
}

pub struct DocumentWatcher {
    inner: Arc<Mutex<Inner>>,
    callback: Arc<dyn Fn(FileChangeEvent) + Send + Sync>,
}

impl DocumentWatcher {
    pub fn new(on_change: impl Fn(FileChangeEvent) + Send + Sync + 'static) -> Self {
        let callback: Arc<dyn Fn(FileChangeEvent) + Send + Sync> = Arc::new(on_change);
        let inner = Arc::new(Mutex::new(Inner {
            files: HashMap::new(),
            dir_refs: HashMap::new(),
            watcher: None,
        }));

        let inner_cb = Arc::clone(&inner);
        let cb = Arc::clone(&callback);
        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                for p in &event.paths {
                    check_and_emit(&inner_cb, &cb, p);
                }
            }
        })
        .ok();

        if let Ok(mut guard) = inner.lock() {
            guard.watcher = watcher;
        }

        Self { inner, callback }
    }

    /// Start watching `path` (or update its known hash if already watched).
    pub fn watch(&self, path: &Path, known_hash: impl Into<String>) {
        let Some((canon_parent, canon_file)) = normalize_file_path(path) else {
            return;
        };
        let display_path = path.to_string_lossy().into_owned();
        let known_hash = known_hash.into();

        let Ok(mut guard) = self.inner.lock() else { return };
        let is_new_file = !guard.files.contains_key(&canon_file);
        if let Some(prev) = guard.files.get(&canon_file) {
            if prev.parent_dir != canon_parent {
                // Unlikely unless moved, keep refcounts consistent.
                let prev_dir = prev.parent_dir.clone();
                decrement_dir(&mut guard, &prev_dir);
                increment_dir(&mut guard, &canon_parent);
            }
        } else if is_new_file {
            increment_dir(&mut guard, &canon_parent);
        }

        guard.files.insert(
            canon_file,
            WatchedEntry {
                display_path,
                parent_dir: canon_parent,
                known_hash,
            },
        );
    }

    /// Stop watching `path` when its tab is closed.
    pub fn unwatch(&self, path: &Path) {
        let Some((_, canon_file)) = normalize_file_path(path) else {
            return;
        };
        let Ok(mut guard) = self.inner.lock() else { return };
        if let Some(removed) = guard.files.remove(&canon_file) {
            decrement_dir(&mut guard, &removed.parent_dir);
        }
    }

    /// Record a hash written by the GUI itself so its own FS event is deduplicated.
    pub fn record_self_write(&self, path: &Path, new_hash: impl Into<String>) {
        let Some((canon_parent, canon_file)) = normalize_file_path(path) else {
            return;
        };
        let new_hash = new_hash.into();
        let Ok(mut guard) = self.inner.lock() else { return };
        if let Some(entry) = guard.files.get_mut(&canon_file) {
            entry.known_hash = new_hash;
        } else {
            increment_dir(&mut guard, &canon_parent);
            guard.files.insert(
                canon_file,
                WatchedEntry {
                    display_path: path.to_string_lossy().into_owned(),
                    parent_dir: canon_parent,
                    known_hash: new_hash,
                },
            );
        }
    }

    /// Immediately probe `path` (e.g. right after an external RPC `doc.write` / `doc.patch`)
    /// without waiting for OS watcher latency; hash deduplication prevents duplicate events.
    pub fn notify_external_write(&self, path: &Path) {
        check_and_emit(&self.inner, &self.callback, path);
    }
}

fn increment_dir(guard: &mut Inner, dir: &Path) {
    let count = guard.dir_refs.entry(dir.to_path_buf()).or_insert(0);
    if *count == 0 {
        if let Some(w) = guard.watcher.as_mut() {
            let _ = w.watch(dir, RecursiveMode::NonRecursive);
        }
    }
    *count += 1;
}

fn decrement_dir(guard: &mut Inner, dir: &Path) {
    if let Some(count) = guard.dir_refs.get_mut(dir) {
        *count = count.saturating_sub(1);
        if *count == 0 {
            guard.dir_refs.remove(dir);
            if let Some(w) = guard.watcher.as_mut() {
                let _ = w.unwatch(dir);
            }
        }
    }
}

fn check_and_emit(
    inner: &Arc<Mutex<Inner>>,
    callback: &Arc<dyn Fn(FileChangeEvent) + Send + Sync>,
    raw_path: &Path,
) {
    // Skip hidden temp files created during atomic writes (`.foo.md.aster-...tmp`).
    if let Some(name) = raw_path.file_name().and_then(|n| n.to_str()) {
        if name.starts_with('.') && name.ends_with(".tmp") {
            return;
        }
    }

    let Some((_, canon_file)) = normalize_file_path(raw_path) else {
        return;
    };

    let (display_path, known_hash) = {
        let Ok(guard) = inner.lock() else { return };
        match guard.files.get(&canon_file) {
            Some(e) => (e.display_path.clone(), e.known_hash.clone()),
            None => return,
        }
    };

    let Ok(doc) = DocumentService::new().read(&canon_file) else {
        return;
    };
    if doc.encoding_lossy || doc.hash == known_hash {
        return;
    }

    // Atomically update known_hash so concurrent FS events don't emit duplicates.
    let should_emit = {
        let Ok(mut guard) = inner.lock() else { return };
        match guard.files.get_mut(&canon_file) {
            Some(entry) if entry.known_hash != doc.hash => {
                entry.known_hash = doc.hash.clone();
                true
            }
            _ => false,
        }
    };

    if should_emit {
        callback(FileChangeEvent {
            path: display_path,
            content: doc.content,
            hash: doc.hash,
        });
    }
}
