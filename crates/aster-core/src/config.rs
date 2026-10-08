use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::error::{AsterError, AsterResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// 自动保存延迟（ms），0 表示禁用
    pub auto_save_delay_ms: u64,
    /// 是否开启更新检查（默认关）
    pub update_check_enabled: bool,
    /// 主题："system" | "light" | "dark"
    pub theme: String,
    /// 中英文间距（仅影响显示）
    pub cjk_spacing: bool,
    /// 打字机滚动
    pub typewriter_scroll: bool,
    /// 段落高亮
    pub paragraph_highlight: bool,
    /// 图片保存目录（相对于文档），默认 "assets"
    pub image_assets_dir: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            auto_save_delay_ms: 1000,
            update_check_enabled: false,
            theme: "system".into(),
            cjk_spacing: true,
            typewriter_scroll: false,
            paragraph_highlight: false,
            image_assets_dir: "assets".into(),
        }
    }
}

fn config_path() -> PathBuf {
    // ASTER_CONFIG_DIR 供测试覆盖
    if let Ok(dir) = std::env::var("ASTER_CONFIG_DIR") {
        return PathBuf::from(dir).join("config.json");
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("config.json")
}

impl Config {
    pub fn load() -> AsterResult<Self> {
        let path = config_path();
        if !path.exists() {
            return Ok(Self::default());
        }
        let data = std::fs::read_to_string(&path)
            .map_err(|e| AsterError::Io(e.to_string()))?;
        serde_json::from_str(&data)
            .map_err(|e| AsterError::InvalidParams(e.to_string()))
    }

    pub fn save(&self) -> AsterResult<()> {
        let path = config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| AsterError::Io(e.to_string()))?;
        // 原子写：tmp → rename
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, &json)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }
}
