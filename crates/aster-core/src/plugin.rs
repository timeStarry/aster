use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};
use crate::error::{AsterError, AsterResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PluginSource { Builtin, User }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub permissions: Vec<String>,
    pub activation: Vec<String>,
    pub frontend_path: Option<PathBuf>,
    pub dir: PathBuf,
    pub source: PluginSource,
}

#[derive(Debug, Default)]
pub struct PluginHost {
    plugins: HashMap<String, PluginInfo>,
}

#[derive(Deserialize)]
struct RawManifest {
    id: String,
    name: String,
    version: String,
    #[serde(rename = "apiVersion")]
    api_version: String,
    description: String,
    permissions: Vec<String>,
    activation: Vec<String>,
    frontend: Option<String>,
}

impl PluginHost {
    pub fn new() -> Self { Self::default() }

    /// Scan `dir` for subdirectories containing `aster.plugin.json`.
    /// Invalid manifests are silently skipped (logged to stderr).
    /// When `source` is `User`, it overrides any existing `Builtin` entry with the same id.
    pub fn load_dir(&mut self, dir: &Path, source: PluginSource) -> AsterResult<()> {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return Ok(()), // non-existent dirs are fine
        };
        for entry in entries.flatten() {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() { continue; }
            let manifest_path = plugin_dir.join("aster.plugin.json");
            if !manifest_path.exists() { continue; }
            match self.load_one(&plugin_dir, source.clone()) {
                Ok(info) => {
                    let should_insert = match self.plugins.get(&info.id) {
                        None => true,
                        Some(existing) => source == PluginSource::User
                            && existing.source == PluginSource::Builtin,
                    };
                    if should_insert {
                        self.plugins.insert(info.id.clone(), info);
                    }
                }
                Err(e) => {
                    eprintln!("[aster-plugins] skipping {:?}: {e}", plugin_dir.file_name());
                }
            }
        }
        Ok(())
    }

    fn load_one(&self, dir: &Path, source: PluginSource) -> AsterResult<PluginInfo> {
        let raw = std::fs::read(dir.join("aster.plugin.json"))
            .map_err(|e| AsterError::Io(e.to_string()))?;
        let m: RawManifest = serde_json::from_slice(&raw)
            .map_err(|e| AsterError::InvalidParams(
                format!("invalid manifest in {:?}: {e}", dir.file_name())
            ))?;
        if m.api_version != "1" {
            return Err(AsterError::InvalidParams(
                format!("unsupported apiVersion {:?} in plugin {:?}", m.api_version, m.id)
            ));
        }
        let frontend_path = m.frontend.as_ref().map(|f| dir.join(f));
        Ok(PluginInfo {
            id: m.id,
            name: m.name,
            version: m.version,
            description: m.description,
            permissions: m.permissions,
            activation: m.activation,
            frontend_path,
            dir: dir.to_path_buf(),
            source,
        })
    }

    pub fn list(&self) -> Vec<&PluginInfo> {
        let mut v: Vec<_> = self.plugins.values().collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    }

    pub fn get(&self, id: &str) -> Option<&PluginInfo> {
        self.plugins.get(id)
    }
}
