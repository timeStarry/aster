//! Zero-interruption image asset hosting (`assets/`), OS drag-drop image copying,
//! untitled-draft-to-document asset migration on `⌘S`, and standalone export writing.

use crate::recovery;
use aster_core::document::atomic_temp_path;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

static ASSET_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedAssetDto {
    /// Relative Markdown path to insert, e.g. `assets/img-1700000000-a1b2c3d4.png`
    pub rel_path: String,
    /// Absolute path on disk where the image was written
    pub abs_path: String,
    /// Base directory (parent of saved doc or `~/.aster/drafts/<id>`) for `resolveImage`
    pub base_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigratedDraftDto {
    pub content: String,
    pub migrated_count: usize,
}

pub fn sanitize_assets_dir(raw: &str) -> Result<String, String> {
    let trimmed = raw
        .trim()
        .trim_start_matches("./")
        .trim_start_matches(".\\")
        .trim_matches(['/', '\\']);
    if trimmed.is_empty() {
        return Ok("assets".into());
    }
    if trimmed.contains(':') {
        return Err("assets directory must be relative".into());
    }
    let mut parts = Vec::new();
    for comp in Path::new(trimmed).components() {
        match comp {
            Component::Normal(s) => {
                let seg = s.to_str().ok_or("invalid assets directory encoding")?;
                if seg.is_empty() || seg == "." || seg == ".." {
                    return Err("invalid assets directory segment".into());
                }
                parts.push(seg);
            }
            Component::CurDir => {}
            _ => return Err("assets directory cannot escape document folder".into()),
        }
    }
    if parts.is_empty() {
        Ok("assets".into())
    } else {
        Ok(parts.join("/"))
    }
}

pub fn sanitize_image_ext(ext_or_mime: &str) -> Result<&'static str, String> {
    let lower = ext_or_mime.trim().trim_start_matches('.').to_ascii_lowercase();
    match lower.as_str() {
        "png" | "image/png" => Ok("png"),
        "jpg" | "jpeg" | "image/jpeg" | "image/jpg" => Ok("jpg"),
        "gif" | "image/gif" => Ok("gif"),
        "webp" | "image/webp" => Ok("webp"),
        "svg" | "svg+xml" | "image/svg+xml" => Ok("svg"),
        "avif" | "image/avif" => Ok("avif"),
        _ => Err(format!("unsupported image format: {ext_or_mime}")),
    }
}

fn fnv1a_hex8(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:08x}", (h & 0xffff_ffff) as u32)
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn write_atomic_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = atomic_temp_path(path);
    if let Err(e) = std::fs::write(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

fn resolve_target_base_dir(doc_path: Option<&Path>, draft_id: Option<&str>) -> Result<PathBuf, String> {
    if let Some(dp) = doc_path {
        let parent = dp
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        return Ok(parent.to_path_buf());
    }
    if let Some(did) = draft_id {
        let dir = recovery::draft_dir_for(did)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir);
    }
    Err("either doc_path or draft_id must be provided".into())
}

pub fn save_image_bytes(
    doc_path: Option<&Path>,
    draft_id: Option<&str>,
    assets_dir: &str,
    ext_or_mime: &str,
    bytes: &[u8],
) -> Result<SavedAssetDto, String> {
    if bytes.is_empty() {
        return Err("image payload is empty".into());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("image exceeds 32 MiB limit".into());
    }
    let clean_dir = sanitize_assets_dir(assets_dir)?;
    let ext = sanitize_image_ext(ext_or_mime)?;
    let base_dir = resolve_target_base_dir(doc_path, draft_id)?;

    let hash8 = fnv1a_hex8(bytes);
    let seq = ASSET_SEQ.fetch_add(1, Ordering::Relaxed);
    let filename = format!("img-{}-{hash8}-{seq}.{ext}", unix_ms());
    let rel_path = format!("{clean_dir}/{filename}");
    let abs_path = base_dir.join(&clean_dir).join(&filename);

    write_atomic_file(&abs_path, bytes)?;

    Ok(SavedAssetDto {
        rel_path,
        abs_path: abs_path.to_string_lossy().into_owned(),
        base_dir: base_dir.to_string_lossy().into_owned(),
    })
}

fn sanitize_stem(stem: &str) -> String {
    let cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let collapsed = cleaned.trim_matches('-');
    if collapsed.is_empty() {
        "img".into()
    } else {
        collapsed.chars().take(40).collect()
    }
}

pub fn copy_image_file(
    source_path: &Path,
    doc_path: Option<&Path>,
    draft_id: Option<&str>,
    assets_dir: &str,
) -> Result<SavedAssetDto, String> {
    if !source_path.is_file() {
        return Err(format!("image not found: {}", source_path.display()));
    }
    let ext_raw = source_path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or("image file has no extension")?;
    let ext = sanitize_image_ext(ext_raw)?;
    let bytes = std::fs::read(source_path).map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("invalid or oversized image file".into());
    }

    let clean_dir = sanitize_assets_dir(assets_dir)?;
    let base_dir = resolve_target_base_dir(doc_path, draft_id)?;
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(sanitize_stem)
        .unwrap_or_else(|| "img".into());
    let hash8 = fnv1a_hex8(&bytes);
    let filename = format!("{stem}-{hash8}.{ext}");
    let rel_path = format!("{clean_dir}/{filename}");
    let abs_path = base_dir.join(&clean_dir).join(&filename);

    if !abs_path.exists() {
        write_atomic_file(&abs_path, &bytes)?;
    }

    Ok(SavedAssetDto {
        rel_path,
        abs_path: abs_path.to_string_lossy().into_owned(),
        base_dir: base_dir.to_string_lossy().into_owned(),
    })
}

fn collect_draft_asset_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_draft_asset_files(root, &path, out);
        } else if !(dir == root && name == "content.md") {
            out.push(path);
        }
    }
}

/// Migrate all pasted/dropped image assets from `~/.aster/drafts/<draft_id>/` into
/// `<parent(target_doc_path)>/<assets_dir>/` when an untitled draft is saved (`⌘S`),
/// rewriting relative paths in `content` automatically if needed.
pub fn migrate_draft_assets(
    draft_id: &str,
    target_doc_path: &Path,
    assets_dir: &str,
    content: &str,
) -> Result<MigratedDraftDto, String> {
    let draft_dir = recovery::draft_dir_for(draft_id)?;
    if !draft_dir.is_dir() {
        return Ok(MigratedDraftDto {
            content: content.to_owned(),
            migrated_count: 0,
        });
    }

    let mut files = Vec::new();
    collect_draft_asset_files(&draft_dir, &draft_dir, &mut files);
    if files.is_empty() {
        return Ok(MigratedDraftDto {
            content: content.to_owned(),
            migrated_count: 0,
        });
    }

    let clean_dir = sanitize_assets_dir(assets_dir)?;
    let doc_parent = target_doc_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let dest_assets_dir = doc_parent.join(&clean_dir);
    std::fs::create_dir_all(&dest_assets_dir).map_err(|e| e.to_string())?;

    let mut updated = content.to_owned();
    let mut migrated_count = 0usize;

    files.sort();
    for src_file in files {
        let Ok(bytes) = std::fs::read(&src_file) else { continue };
        let old_rel = src_file
            .strip_prefix(&draft_dir)
            .unwrap_or(&src_file)
            .to_string_lossy()
            .replace('\\', "/");
        let orig_name = src_file
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("asset.png");
        let stem = src_file
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("asset");
        let ext = src_file.extension().and_then(|e| e.to_str()).unwrap_or("png");

        // Resolve collision-free filename in target `<doc_parent>/<clean_dir>/`
        let mut final_name = orig_name.to_owned();
        let mut n = 2usize;
        loop {
            let candidate = dest_assets_dir.join(&final_name);
            if !candidate.exists() {
                write_atomic_file(&candidate, &bytes)?;
                break;
            }
            if let Ok(existing) = std::fs::read(&candidate) {
                if existing == bytes {
                    break;
                }
            }
            final_name = format!("{stem}-{n}.{ext}");
            n += 1;
        }

        let new_rel = format!("{clean_dir}/{final_name}");
        if new_rel != old_rel {
            updated = updated
                .replace(&format!("]({old_rel})"), &format!("]({new_rel})"))
                .replace(&format!("](<{old_rel}>)"), &format!("](<{new_rel}>)"))
                .replace(&format!("src=\"{old_rel}\""), &format!("src=\"{new_rel}\""))
                .replace(&format!("src='{old_rel}'"), &format!("src='{new_rel}'"));
        }
        migrated_count += 1;
    }

    Ok(MigratedDraftDto {
        content: updated,
        migrated_count,
    })
}

fn grant_dir_scope(app: &tauri::AppHandle, dir: &Path) {
    if let Ok(canon) = std::fs::canonicalize(dir) {
        use tauri::Manager;
        let _ = app.asset_protocol_scope().allow_directory(&canon, true);
    }
}

#[tauri::command]
pub fn asset_save_bytes(
    doc_path: Option<String>,
    draft_id: Option<String>,
    assets_dir: String,
    ext: String,
    bytes: Vec<u8>,
    app: tauri::AppHandle,
) -> Result<SavedAssetDto, String> {
    let dto = save_image_bytes(
        doc_path.as_deref().map(Path::new),
        draft_id.as_deref(),
        &assets_dir,
        &ext,
        &bytes,
    )?;
    grant_dir_scope(&app, Path::new(&dto.base_dir));
    Ok(dto)
}

#[tauri::command]
pub fn asset_copy_file(
    source_path: String,
    doc_path: Option<String>,
    draft_id: Option<String>,
    assets_dir: String,
    app: tauri::AppHandle,
) -> Result<SavedAssetDto, String> {
    let dto = copy_image_file(
        Path::new(&source_path),
        doc_path.as_deref().map(Path::new),
        draft_id.as_deref(),
        &assets_dir,
    )?;
    grant_dir_scope(&app, Path::new(&dto.base_dir));
    Ok(dto)
}

#[tauri::command]
pub fn asset_migrate_draft(
    draft_id: String,
    target_doc_path: String,
    assets_dir: String,
    content: String,
    app: tauri::AppHandle,
) -> Result<MigratedDraftDto, String> {
    let target = Path::new(&target_doc_path);
    let res = migrate_draft_assets(&draft_id, target, &assets_dir, &content)?;
    if let Some(parent) = target.parent() {
        grant_dir_scope(&app, parent);
    }
    Ok(res)
}

#[tauri::command]
pub fn export_write_file(path: String, content: String) -> Result<(), String> {
    if content.len() > MAX_EXPORT_BYTES {
        return Err("exported document exceeds 64 MiB limit".into());
    }
    write_atomic_file(Path::new(&path), content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_assets_dir_and_rejects_traversal() {
        assert_eq!(sanitize_assets_dir("").unwrap(), "assets");
        assert_eq!(sanitize_assets_dir("./assets/").unwrap(), "assets");
        assert_eq!(sanitize_assets_dir("media/img").unwrap(), "media/img");
        assert!(sanitize_assets_dir("../outside").is_err());
        assert!(sanitize_assets_dir("assets/../../etc").is_err());
        assert!(sanitize_assets_dir("C:/temp").is_err());
    }

    #[test]
    fn draft_paste_and_save_migration_rewrites_collisions_cleanly() {
        let _guard = crate::recovery::ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let cfg_dir = tempfile::tempdir().unwrap();
        let target_dir = tempfile::tempdir().unwrap();
        std::env::set_var("ASTER_CONFIG_DIR", cfg_dir.path());

        let saved = save_image_bytes(
            None,
            Some("draft-img-test"),
            "assets",
            "image/png",
            b"\x89PNG\r\n\x1a\nfake-draft-image",
        )
        .unwrap();
        assert!(saved.rel_path.starts_with("assets/img-"));
        assert!(Path::new(&saved.abs_path).exists());

        // Pre-populate a colliding filename with DIFFERENT bytes at the target folder
        let target_md = target_dir.path().join("article.md");
        let colliding_target = target_dir.path().join(&saved.rel_path);
        std::fs::create_dir_all(colliding_target.parent().unwrap()).unwrap();
        std::fs::write(&colliding_target, b"different-existing-image").unwrap();

        let md_before = format!("# Draft\n\n![Screenshot]({})\n", saved.rel_path);
        let migrated = migrate_draft_assets("draft-img-test", &target_md, "assets", &md_before).unwrap();
        assert_eq!(migrated.migrated_count, 1);
        assert!(migrated.content.contains("-2.png)"));
        assert!(!migrated.content.contains(&format!("]({})", saved.rel_path)));

        std::env::remove_var("ASTER_CONFIG_DIR");
    }
}
