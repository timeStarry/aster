//! Opening the project page in the system browser.
//!
//! The URL is fixed here rather than passed in from the webview, so page
//! content can never make the app open arbitrary URLs or programs.

pub const REPO_URL: &str = "https://github.com/timeStarry/aster";

#[tauri::command]
pub fn open_repo() -> Result<(), String> {
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
    cmd.arg(REPO_URL).spawn().map(|_| ()).map_err(|e| e.to_string())
}
