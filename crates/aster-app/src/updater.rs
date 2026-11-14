use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::sync::Once;
use std::time::Duration;
use tauri::Emitter;

const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/timeStarry/aster/releases?per_page=15";
const REPO_HTML_RELEASES: &str = "https://github.com/timeStarry/aster/releases";

static CRYPTO_INIT: Once = Once::new();

fn ensure_crypto_provider() {
    CRYPTO_INIT.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

fn build_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    ensure_crypto_provider();
    reqwest::Client::builder()
        .user_agent(format!("Aster/{}", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("failed to initialize HTTP client: {e}"))
}

#[derive(Debug, Clone, Deserialize)]
pub struct GhAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GhRelease {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<GhAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: String,
    pub html_url: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub asset_size: Option<u64>,
    pub checksum_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResult {
    /// "relaunch" | "installer_launched" | "opened_installer"
    pub action: String,
    pub target_path: String,
}

pub fn parse_release_version(tag: &str) -> Option<Version> {
    let cleaned = tag.trim().trim_start_matches('v').trim_start_matches('V');
    Version::parse(cleaned).ok()
}

/// Strict allowlist for GitHub release download URLs to prevent arbitrary URL fetching.
pub fn is_trusted_github_asset_url(raw: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(raw) else {
        return false;
    };
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    let path = parsed.path();
    match host.as_str() {
        "github.com" => path.starts_with("/timeStarry/aster/releases/download/"),
        "api.github.com" => path.starts_with("/repos/timeStarry/aster/releases/assets/"),
        "objects.githubusercontent.com" | "release-assets.githubusercontent.com" => true,
        _ => false,
    }
}

pub fn pick_platform_asset<'a>(
    assets: &'a [GhAsset],
    os: &str,
    arch: &str,
) -> (Option<&'a GhAsset>, Option<&'a GhAsset>) {
    let find_checksum = |needle: &str| -> Option<&'a GhAsset> {
        assets
            .iter()
            .find(|a| a.name.eq_ignore_ascii_case(needle))
            .or_else(|| {
                assets
                    .iter()
                    .find(|a| a.name.starts_with("SHA256SUMS") && a.name.ends_with(".txt"))
            })
    };

    match os {
        "macos" => {
            let preferred = assets
                .iter()
                .filter(|a| a.name.to_ascii_lowercase().ends_with(".dmg"))
                .find(|a| {
                    let lower = a.name.to_ascii_lowercase();
                    if arch == "aarch64" {
                        lower.contains("aarch64") || lower.contains("arm64") || lower.contains("universal")
                    } else {
                        lower.contains("x64") || lower.contains("x86_64") || lower.contains("universal")
                    }
                })
                .or_else(|| {
                    assets
                        .iter()
                        .find(|a| a.name.to_ascii_lowercase().ends_with(".dmg"))
                });
            let sum_name = if arch == "aarch64" {
                "SHA256SUMS-aarch64-apple-darwin.txt"
            } else {
                "SHA256SUMS-x86_64-apple-darwin.txt"
            };
            (preferred, find_checksum(sum_name))
        }
        "windows" => {
            let preferred = assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".exe"))
                .or_else(|| {
                    assets
                        .iter()
                        .find(|a| a.name.to_ascii_lowercase().ends_with(".msi"))
                });
            (preferred, find_checksum("SHA256SUMS-x86_64-pc-windows-msvc.txt"))
        }
        "linux" => {
            let preferred = assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".appimage"))
                .or_else(|| {
                    assets
                        .iter()
                        .find(|a| a.name.to_ascii_lowercase().ends_with(".deb"))
                });
            (preferred, find_checksum("SHA256SUMS-x86_64-unknown-linux-gnu.txt"))
        }
        _ => (None, None),
    }
}

pub fn select_latest_release(
    releases: &[GhRelease],
    current_version_str: &str,
    os: &str,
    arch: &str,
) -> Result<ReleaseUpdateInfo, String> {
    let current = parse_release_version(current_version_str)
        .ok_or_else(|| format!("invalid current version: {current_version_str}"))?;
    let on_prerelease = !current.pre.is_empty();

    let mut candidates: Vec<(Version, &GhRelease)> = releases
        .iter()
        .filter(|r| !r.draft)
        .filter_map(|r| parse_release_version(&r.tag_name).map(|v| (v, r)))
        .collect();

    // Sort highest SemVer first.
    candidates.sort_by(|a, b| b.0.cmp(&a.0));

    let chosen = if on_prerelease {
        candidates.first()
    } else {
        candidates
            .iter()
            .find(|(v, r)| !r.prerelease && v.pre.is_empty())
            .or_else(|| candidates.first())
    };

    let Some((best_ver, rel)) = chosen else {
        return Ok(ReleaseUpdateInfo {
            current_version: current.to_string(),
            latest_version: current.to_string(),
            has_update: false,
            release_name: format!("v{current}"),
            release_notes: String::new(),
            published_at: String::new(),
            html_url: REPO_HTML_RELEASES.into(),
            asset_name: None,
            asset_url: None,
            asset_size: None,
            checksum_url: None,
        });
    };

    let has_update = best_ver > &current;
    let (asset, checksum) = pick_platform_asset(&rel.assets, os, arch);

    Ok(ReleaseUpdateInfo {
        current_version: current.to_string(),
        latest_version: best_ver.to_string(),
        has_update,
        release_name: rel
            .name
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&rel.tag_name)
            .to_owned(),
        release_notes: rel.body.clone().unwrap_or_default(),
        published_at: rel.published_at.clone().unwrap_or_default(),
        html_url: if rel.html_url.is_empty() {
            REPO_HTML_RELEASES.into()
        } else {
            rel.html_url.clone()
        },
        asset_name: asset.map(|a| a.name.clone()),
        asset_url: asset.map(|a| a.browser_download_url.clone()),
        asset_size: asset.map(|a| a.size),
        checksum_url: checksum.map(|c| c.browser_download_url.clone()),
    })
}

pub fn parse_sha256_for_asset(sums_text: &str, asset_name: &str) -> Option<String> {
    for line in sums_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let Some(hash) = parts.next() else { continue };
        let Some(raw_file) = parts.next() else { continue };
        let file = raw_file.trim_start_matches('*');
        if file == asset_name && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

fn sanitize_asset_filename(name: &str) -> Result<String, String> {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid asset filename".to_owned())?;
    if base.is_empty() || base.contains("..") || base.contains('/') || base.contains('\\') {
        return Err("unsafe asset filename".into());
    }
    Ok(base.to_owned())
}

#[tauri::command]
pub async fn update_check() -> Result<ReleaseUpdateInfo, String> {
    let client = build_http_client(15)?;
    let resp = client
        .get(GITHUB_RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("network error contacting GitHub Releases: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned HTTP {}", resp.status()));
    }

    let releases: Vec<GhRelease> = resp
        .json()
        .await
        .map_err(|e| format!("failed to parse GitHub Releases response: {e}"))?;

    select_latest_release(
        &releases,
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
    )
}

#[tauri::command]
pub async fn update_download_and_install(
    app: tauri::AppHandle,
    asset_name: String,
    asset_url: String,
    checksum_url: Option<String>,
) -> Result<UpdateInstallResult, String> {
    let safe_name = sanitize_asset_filename(&asset_name)?;
    if !is_trusted_github_asset_url(&asset_url) {
        return Err("untrusted update asset URL rejected".into());
    }
    if let Some(ref sum_url) = checksum_url {
        if !is_trusted_github_asset_url(sum_url) {
            return Err("untrusted checksum URL rejected".into());
        }
    }

    let work_dir = std::env::temp_dir().join(format!("aster-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work_dir);
    std::fs::create_dir_all(&work_dir)
        .map_err(|e| format!("failed to create update staging directory: {e}"))?;
    let dest_path = work_dir.join(&safe_name);

    let client = build_http_client(300)?;

    // Fetch expected SHA-256 first if available.
    let expected_sha256 = if let Some(ref sum_url) = checksum_url {
        let resp = client
            .get(sum_url)
            .send()
            .await
            .map_err(|e| format!("failed to fetch SHA256SUMS: {e}"))?;
        if resp.status().is_success() {
            let text = resp
                .text()
                .await
                .map_err(|e| format!("failed to read SHA256SUMS: {e}"))?;
            parse_sha256_for_asset(&text, &safe_name)
        } else {
            None
        }
    } else {
        None
    };

    let resp = client
        .get(&asset_url)
        .send()
        .await
        .map_err(|e| format!("failed to download update package: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed with HTTP {}", resp.status()));
    }

    let total_bytes = resp.content_length();
    let _ = app.emit(
        "aster://update-progress",
        UpdateProgressEvent {
            stage: "downloading".into(),
            downloaded_bytes: 0,
            total_bytes,
            percent: Some(0),
        },
    );

    let mut file = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| format!("failed to create temporary installer file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_percent: Option<u8> = Some(0);
    let mut stream = resp.bytes_stream();

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("download stream interrupted: {e}"))?;
        hasher.update(&chunk);
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| format!("failed writing installer chunk: {e}"))?;
        downloaded += chunk.len() as u64;
        let pct = total_bytes
            .filter(|&t| t > 0)
            .map(|t| ((downloaded.saturating_mul(100)) / t).min(100) as u8);
        if pct != last_percent {
            last_percent = pct;
            let _ = app.emit(
                "aster://update-progress",
                UpdateProgressEvent {
                    stage: "downloading".into(),
                    downloaded_bytes: downloaded,
                    total_bytes,
                    percent: pct,
                },
            );
        }
    }
    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| format!("failed flushing installer file: {e}"))?;
    drop(file);

    // Verify SHA-256 checksum when provided by release workflow.
    let _ = app.emit(
        "aster://update-progress",
        UpdateProgressEvent {
            stage: "verifying".into(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent: Some(100),
        },
    );
    let actual_sha256 = hex::encode(hasher.finalize());
    if let Some(expected) = expected_sha256 {
        if actual_sha256 != expected {
            let _ = std::fs::remove_dir_all(&work_dir);
            return Err(format!(
                "SHA-256 verification failed (expected {expected}, got {actual_sha256})"
            ));
        }
    }

    let _ = app.emit(
        "aster://update-progress",
        UpdateProgressEvent {
            stage: "installing".into(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent: Some(100),
        },
    );

    let install_res = tokio::task::spawn_blocking(move || install_downloaded_package(&work_dir, &dest_path))
        .await
        .map_err(|e| format!("installer task panicked: {e}"))??;

    let _ = app.emit(
        "aster://update-progress",
        UpdateProgressEvent {
            stage: install_res.action.clone(),
            downloaded_bytes: downloaded,
            total_bytes,
            percent: Some(100),
        },
    );

    Ok(install_res)
}

#[tauri::command]
pub fn update_relaunch(app: tauri::AppHandle) {
    app.restart();
}

fn install_downloaded_package(
    work_dir: &Path,
    package_path: &Path,
) -> Result<UpdateInstallResult, String> {
    #[cfg(target_os = "macos")]
    {
        return install_macos_dmg(work_dir, package_path);
    }

    #[cfg(target_os = "windows")]
    {
        let _ = work_dir;
        let is_msi = package_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("msi"))
            .unwrap_or(false);
        if is_msi {
            std::process::Command::new("msiexec")
                .arg("/i")
                .arg(package_path)
                .spawn()
                .map_err(|e| format!("failed to launch MSI installer: {e}"))?;
        } else {
            std::process::Command::new(package_path)
                .spawn()
                .map_err(|e| format!("failed to launch setup installer: {e}"))?;
        }
        return Ok(UpdateInstallResult {
            action: "installer_launched".into(),
            target_path: package_path.to_string_lossy().into_owned(),
        });
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = work_dir;
        std::process::Command::new("xdg-open")
            .arg(package_path)
            .spawn()
            .map_err(|e| format!("failed to open downloaded package: {e}"))?;
        return Ok(UpdateInstallResult {
            action: "opened_installer".into(),
            target_path: package_path.to_string_lossy().into_owned(),
        });
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_app_bundle() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors() {
            if ancestor
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("app"))
                .unwrap_or(false)
            {
                return ancestor.to_path_buf();
            }
        }
    }
    PathBuf::from("/Applications/Aster.app")
}

#[cfg(target_os = "macos")]
fn can_write_target_app(app_bundle: &Path) -> bool {
    let check_dir = if app_bundle.exists() {
        app_bundle
    } else {
        app_bundle.parent().unwrap_or_else(|| Path::new("/Applications"))
    };
    let probe = check_dir.join(format!(".aster-write-probe-{}", std::process::id()));
    if std::fs::File::create(&probe).is_ok() {
        let _ = std::fs::remove_file(&probe);
        true
    } else {
        false
    }
}

#[cfg(target_os = "macos")]
fn install_macos_dmg(work_dir: &Path, dmg_path: &Path) -> Result<UpdateInstallResult, String> {
    let target_app = resolve_macos_app_bundle();
    if !can_write_target_app(&target_app) {
        // Fallback: open the verified DMG in Finder so the user can drag-and-drop with admin prompt.
        std::process::Command::new("/usr/bin/open")
            .arg(dmg_path)
            .spawn()
            .map_err(|e| format!("failed to open DMG installer: {e}"))?;
        return Ok(UpdateInstallResult {
            action: "opened_installer".into(),
            target_path: dmg_path.to_string_lossy().into_owned(),
        });
    }

    let mount_dir = work_dir.join("mnt");
    std::fs::create_dir_all(&mount_dir)
        .map_err(|e| format!("failed to create DMG mount point: {e}"))?;

    let attach_status = std::process::Command::new("/usr/bin/hdiutil")
        .args(["attach", "-nobrowse", "-readonly", "-quiet", "-mountpoint"])
        .arg(&mount_dir)
        .arg(dmg_path)
        .status()
        .map_err(|e| format!("failed to run hdiutil attach: {e}"))?;

    if !attach_status.success() {
        return Err("failed to mount update DMG image".into());
    }

    struct DetachGuard(PathBuf);
    impl Drop for DetachGuard {
        fn drop(&mut self) {
            let _ = std::process::Command::new("/usr/bin/hdiutil")
                .args(["detach", "-force", "-quiet"])
                .arg(&self.0)
                .status();
        }
    }
    let _guard = DetachGuard(mount_dir.clone());

    let staged_app = mount_dir.join("Aster.app");
    if !staged_app.is_dir() {
        return Err("Aster.app not found inside update DMG".into());
    }

    let verify_status = std::process::Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(&staged_app)
        .status()
        .map_err(|e| format!("failed to run codesign verification: {e}"))?;
    if !verify_status.success() {
        return Err("code signature verification failed on downloaded Aster.app".into());
    }

    let mut src_arg = staged_app.into_os_string();
    src_arg.push("/");
    let mut dst_arg = target_app.clone().into_os_string();
    dst_arg.push("/");

    let rsync_status = std::process::Command::new("/usr/bin/rsync")
        .args(["-a", "--delete"])
        .arg(src_arg)
        .arg(dst_arg)
        .status()
        .map_err(|e| format!("failed to replace Aster.app via rsync: {e}"))?;

    if !rsync_status.success() {
        return Err("failed to copy updated Aster.app into place".into());
    }

    drop(_guard);
    let _ = std::fs::remove_dir_all(work_dir);

    Ok(UpdateInstallResult {
        action: "relaunch".into(),
        target_path: target_app.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_release(tag: &str, prerelease: bool, assets: Vec<(&str, &str)>) -> GhRelease {
        GhRelease {
            tag_name: tag.into(),
            name: Some(format!("Aster {tag}")),
            body: Some("Bug fixes and improvements".into()),
            draft: false,
            prerelease,
            html_url: format!("https://github.com/timeStarry/aster/releases/tag/{tag}"),
            published_at: Some("2026-11-14T00:00:00Z".into()),
            assets: assets
                .into_iter()
                .map(|(n, u)| GhAsset {
                    name: n.into(),
                    browser_download_url: u.into(),
                    size: 6_200_000,
                })
                .collect(),
        }
    }

    #[test]
    fn selects_newer_prerelease_and_platform_assets_accurately() {
        let releases = vec![
            sample_release(
                "v0.1.0-alpha.9",
                true,
                vec![
                    (
                        "Aster_0.1.0-alpha.9_aarch64.dmg",
                        "https://github.com/timeStarry/aster/releases/download/v0.1.0-alpha.9/Aster_0.1.0-alpha.9_aarch64.dmg",
                    ),
                    (
                        "SHA256SUMS-aarch64-apple-darwin.txt",
                        "https://github.com/timeStarry/aster/releases/download/v0.1.0-alpha.9/SHA256SUMS-aarch64-apple-darwin.txt",
                    ),
                    (
                        "Aster_0.1.0-alpha.9_x64-setup.exe",
                        "https://github.com/timeStarry/aster/releases/download/v0.1.0-alpha.9/Aster_0.1.0-alpha.9_x64-setup.exe",
                    ),
                ],
            ),
            sample_release("v0.1.0-alpha.8", true, vec![]),
        ];

        let info = select_latest_release(&releases, "0.1.0-alpha.8", "macos", "aarch64").unwrap();
        assert!(info.has_update);
        assert_eq!(info.latest_version, "0.1.0-alpha.9");
        assert_eq!(
            info.asset_name.as_deref(),
            Some("Aster_0.1.0-alpha.9_aarch64.dmg")
        );
        assert!(info.checksum_url.is_some());

        let up_to_date =
            select_latest_release(&releases, "0.1.0-alpha.9", "macos", "aarch64").unwrap();
        assert!(!up_to_date.has_update);
    }

    #[test]
    fn enforces_trusted_github_asset_urls_and_parses_sha256sums() {
        assert!(is_trusted_github_asset_url(
            "https://github.com/timeStarry/aster/releases/download/v0.2.0/Aster_0.2.0_aarch64.dmg"
        ));
        assert!(is_trusted_github_asset_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/123"
        ));
        assert!(!is_trusted_github_asset_url(
            "http://github.com/timeStarry/aster/releases/download/v0.2.0/Aster.dmg"
        ));
        assert!(!is_trusted_github_asset_url(
            "https://github.com/evil/repo/releases/download/v0.2.0/Aster.dmg"
        ));
        assert!(!is_trusted_github_asset_url("https://evil.example.com/Aster.dmg"));

        let sums = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  Aster_0.2.0_aarch64.dmg\n";
        assert_eq!(
            parse_sha256_for_asset(sums, "Aster_0.2.0_aarch64.dmg").as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
        assert_eq!(parse_sha256_for_asset(sums, "other.dmg"), None);
    }
}
