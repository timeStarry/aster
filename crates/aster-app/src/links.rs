//! Opening safe external web/mail links in the system browser.
//!
//! Only `https://`, `http://`, and `mailto:` URLs free of control characters
//! are accepted, preventing page content from launching arbitrary programs or
//! local file schemes.

pub const REPO_URL: &str = "https://github.com/timeStarry/aster";

fn validate_external_url(raw: &str) -> Result<&str, String> {
    let url = raw.trim();
    if url.is_empty() || url.len() > 4096 {
        return Err("invalid URL length".into());
    }
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("URL contains invalid characters".into());
    }
    let lower = url.to_ascii_lowercase();
    let allowed = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !allowed {
        return Err("unsupported URL scheme".into());
    }
    Ok(url)
}

fn spawn_system_opener(url: &str) -> Result<(), String> {
    let safe_url = validate_external_url(url)?;
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(safe_url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_repo() -> Result<(), String> {
    spawn_system_opener(REPO_URL)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    spawn_system_opener(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_safe_http_https_and_mailto_urls() {
        assert!(validate_external_url("https://github.com/timeStarry/aster").is_ok());
        assert!(validate_external_url("http://localhost:3000/docs").is_ok());
        assert!(validate_external_url("mailto:hi@example.com").is_ok());
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("/Applications/Calculator.app").is_err());
        assert!(validate_external_url("https://example.com/a b").is_err());
        assert!(validate_external_url("https://example.com/\nfoo").is_err());
    }
}
