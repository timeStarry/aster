use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::document::atomic_temp_path;
use crate::error::{AsterError, AsterResult};

fn default_auto_save_delay_ms() -> u64 { 1000 }
fn default_theme() -> String { "system".into() }
fn default_language() -> String { "system".into() }
fn default_true() -> bool { true }
fn default_show_menu_bar() -> bool { !cfg!(target_os = "windows") }
fn default_font_size() -> u32 { 16 }
fn default_line_height() -> f64 { 1.75 }
fn default_prose_width() -> u32 { 760 }
fn default_image_assets_dir() -> String { "assets".into() }
fn default_typography() -> Value {
    json!({
        "followTheme": true,
        "preset": "sans",
        "body": { "stack": "sans" },
        "code": { "stack": "mono" }
    })
}

/// Unified application configuration persisted in `~/.aster/config.json`
/// and shared across the desktop UI, CLI, and JSON-RPC / MCP callers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Interface language: "system" | "en" | "zh"
    #[serde(default = "default_language")]
    pub language: String,
    /// Theme id: "system" | "paper" | "light" | "dark" | "midnight" | plugin theme id
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Native menu bar visibility (primarily Windows)
    #[serde(default = "default_show_menu_bar")]
    pub show_menu_bar: bool,
    /// Typography preferences object (`{ followTheme, preset, body, code }`)
    #[serde(default = "default_typography")]
    pub typography: Value,
    /// Editor font size in px (12..=28)
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    /// Editor line height (1.2..=2.2)
    #[serde(default = "default_line_height")]
    pub line_height: f64,
    /// Maximum prose measure width in px
    #[serde(default = "default_prose_width")]
    pub prose_width: u32,
    /// Gutter line numbers
    #[serde(default)]
    pub line_numbers: bool,
    /// Typewriter centered scrolling
    #[serde(default)]
    pub typewriter: bool,
    /// Backwards-compatible alias field kept in sync with `typewriter`
    #[serde(default)]
    pub typewriter_scroll: bool,
    /// Paragraph spotlight / focus dimming
    #[serde(default)]
    pub focus_mode: bool,
    /// Backwards-compatible alias field for paragraph highlight
    #[serde(default)]
    pub paragraph_highlight: bool,
    /// Visual CJK-Latin autospace decoration
    #[serde(default = "default_true")]
    pub cjk_spacing: bool,
    /// Right-edge heading navigator rail
    #[serde(default = "default_true")]
    pub outline_rail: bool,
    /// Line-start `/` block insertion menu
    #[serde(default = "default_true")]
    pub slash_commands: bool,
    /// Automatic background saving of file-backed tabs
    #[serde(default = "default_true")]
    pub auto_save: bool,
    /// Auto-save debounce delay in ms (0 disables auto-save)
    #[serde(default = "default_auto_save_delay_ms")]
    pub auto_save_delay_ms: u64,
    /// Automatic update check toggle (default true)
    #[serde(default = "default_true")]
    pub update_check_enabled: bool,
    /// Relative directory for pasted/dropped images (default "assets")
    #[serde(default = "default_image_assets_dir")]
    pub image_assets_dir: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            language: default_language(),
            theme: default_theme(),
            show_menu_bar: default_show_menu_bar(),
            typography: default_typography(),
            font_size: default_font_size(),
            line_height: default_line_height(),
            prose_width: default_prose_width(),
            line_numbers: false,
            typewriter: false,
            typewriter_scroll: false,
            focus_mode: false,
            paragraph_highlight: false,
            cjk_spacing: true,
            outline_rail: true,
            slash_commands: true,
            auto_save: true,
            auto_save_delay_ms: default_auto_save_delay_ms(),
            update_check_enabled: true,
            image_assets_dir: default_image_assets_dir(),
        }
    }
}

pub fn config_path() -> PathBuf {
    // ASTER_CONFIG_DIR override for isolated unit tests
    if let Ok(dir) = std::env::var("ASTER_CONFIG_DIR") {
        return PathBuf::from(dir).join("config.json");
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("config.json")
}

impl Config {
    pub fn exists_on_disk() -> bool {
        config_path().exists()
    }

    pub fn load() -> AsterResult<Self> {
        let path = config_path();
        if !path.exists() {
            return Ok(Self::default());
        }
        let data = std::fs::read_to_string(&path)
            .map_err(|e| AsterError::Io(e.to_string()))?;
        let mut cfg: Self = serde_json::from_str(&data)
            .map_err(|e| AsterError::InvalidParams(e.to_string()))?;
        // Keep legacy boolean aliases coherent
        if cfg.typewriter_scroll && !cfg.typewriter {
            cfg.typewriter = true;
        }
        cfg.typewriter_scroll = cfg.typewriter;
        if cfg.paragraph_highlight && !cfg.focus_mode {
            cfg.focus_mode = true;
        }
        cfg.paragraph_highlight = cfg.focus_mode;
        Ok(cfg)
    }

    pub fn save(&self) -> AsterResult<()> {
        let path = config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut normalized = self.clone();
        normalized.typewriter_scroll = normalized.typewriter;
        normalized.paragraph_highlight = normalized.focus_mode;

        let json = serde_json::to_string_pretty(&normalized)
            .map_err(|e| AsterError::Io(e.to_string()))?;
        let tmp = atomic_temp_path(&path);
        if let Err(e) = std::fs::write(&tmp, &json) {
            let _ = std::fs::remove_file(&tmp);
            return Err(AsterError::Io(e.to_string()));
        }
        if let Err(e) = std::fs::rename(&tmp, &path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(AsterError::Io(e.to_string()));
        }
        Ok(())
    }
}
