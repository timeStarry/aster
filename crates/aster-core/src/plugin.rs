use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use serde::{Serialize, Deserialize};
use serde_json::Value;
use crate::error::{AsterError, AsterResult};
use crate::wasm_host::WasmHost;
use crate::registry::{CommandRegistry, CommandSpec};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PluginSource { Builtin, User }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContribCommand {
    pub id: String,
    pub description: String,
    pub params: Value,
    pub returns: Value,
    pub headless: bool,
}

/// Localized display strings for one language (e.g. "zh").
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct PluginI18n {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub permissions: Vec<String>,
    pub activation: Vec<String>,
    pub frontend_path: Option<PathBuf>,
    pub backend_path: Option<PathBuf>,
    pub contributes_commands: Vec<ContribCommand>,
    /// Localized name/description keyed by language tag.
    #[serde(default)]
    pub i18n: HashMap<String, PluginI18n>,
    pub dir: PathBuf,
    pub source: PluginSource,
}

pub struct PluginHost {
    plugins: HashMap<String, PluginInfo>,
    pub wasm_host: WasmHost,
}

impl std::fmt::Debug for PluginHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PluginHost")
            .field("plugins", &self.plugins.keys().collect::<Vec<_>>())
            .finish()
    }
}

#[derive(Deserialize)]
struct RawContribCommand {
    id: String,
    description: String,
    params: Value,
    returns: Value,
    #[serde(default)]
    headless: bool,
}

#[derive(Deserialize, Default)]
struct RawContributes {
    #[serde(default)]
    commands: Vec<RawContribCommand>,
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
    backend: Option<String>,
    #[serde(default)]
    contributes: RawContributes,
    #[serde(default)]
    i18n: HashMap<String, PluginI18n>,
}

impl PluginHost {
    pub fn new() -> AsterResult<Self> {
        Ok(Self {
            plugins: HashMap::new(),
            wasm_host: WasmHost::new(),
        })
    }

    /// Scan `dir` for subdirectories containing `aster.plugin.json`.
    /// Invalid manifests are silently skipped (logged to stderr).
    /// When `source` is `User`, it overrides any existing `Builtin` entry with the same id.
    pub fn load_dir(&mut self, dir: &Path, source: PluginSource) -> AsterResult<()> {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return Ok(()),
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
                        // Load WASM component if backend is present
                        if let Some(ref bp) = info.backend_path {
                            if let Err(e) = self.wasm_host.load_component(
                                bp,
                                &info.id,
                                info.permissions.clone(),
                                None,
                            ) {
                                eprintln!("[aster-plugins] wasm load failed for {:?}: {e}", info.id);
                            }
                        }
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
        let backend_path = m.backend.as_ref().map(|b| dir.join(b));
        let contributes_commands = m.contributes.commands.into_iter().map(|c| ContribCommand {
            id: c.id,
            description: c.description,
            params: c.params,
            returns: c.returns,
            headless: c.headless,
        }).collect();
        Ok(PluginInfo {
            id: m.id,
            name: m.name,
            version: m.version,
            description: m.description,
            permissions: m.permissions,
            activation: m.activation,
            frontend_path,
            backend_path,
            contributes_commands,
            i18n: m.i18n,
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

    /// Register commands contributed by loaded WASM plugins into `registry`.
    pub fn register_wasm_commands(
        &self,
        registry: &mut CommandRegistry,
        host: Arc<Mutex<PluginHost>>,
    ) {
        for info in self.plugins.values() {
            if info.backend_path.is_none() { continue; }
            for cmd in &info.contributes_commands {
                let plugin_id = info.id.clone();
                let cmd_id = cmd.id.clone();
                let h = Arc::clone(&host);
                registry.register_with_handler(
                    CommandSpec {
                        id: cmd.id.clone(),
                        description: cmd.description.clone(),
                        params_schema: cmd.params.clone(),
                        returns_schema: cmd.returns.clone(),
                        headless: cmd.headless,
                        source: plugin_id.clone(),
                    },
                    move |params| {
                        let params_json = serde_json::to_string(&params)
                            .unwrap_or_else(|_| "{}".into());
                        let mut h = h.lock()
                            .map_err(|_| AsterError::Io("plugin host lock poisoned".into()))?;
                        let result_json = h.wasm_host.invoke_mut(&plugin_id, &cmd_id, &params_json)?;
                        serde_json::from_str(&result_json)
                            .map_err(|e| AsterError::PluginFailed(e.to_string()))
                    },
                );
            }
        }
    }
}
