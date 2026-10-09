use std::collections::HashMap;
use std::path::Path;
use crate::error::{AsterError, AsterResult};

/// Context that carries permission info for a loaded WASM plugin.
pub struct HostContext {
    permissions: Vec<String>,
    workspace: Option<std::path::PathBuf>,
}

impl HostContext {
    pub fn new(permissions: Vec<String>, workspace: Option<std::path::PathBuf>) -> Self {
        Self { permissions, workspace }
    }

    pub fn check_read_permission(&self, path: &str) -> AsterResult<()> {
        self.check_fs_permission(path)
    }

    pub fn check_write_permission(&self, path: &str) -> AsterResult<()> {
        self.check_fs_permission(path)
    }

    fn check_fs_permission(&self, path: &str) -> AsterResult<()> {
        if self.permissions.contains(&"fs:any".to_string()) {
            return Ok(());
        }
        if self.permissions.contains(&"fs:workspace".to_string()) {
            if let Some(ws) = &self.workspace {
                if Path::new(path).starts_with(ws) {
                    return Ok(());
                }
            }
        }
        Err(AsterError::PermissionDenied(format!(
            "plugin has no permission to access: {path}"
        )))
    }
}

/// Host for WASM backend plugins.
/// In M4 Task 1 this is a skeleton; full wasmtime instantiation is added in Task 2.
pub struct WasmHost {
    loaded: HashMap<String, ()>,
}

impl WasmHost {
    pub fn new() -> Self {
        Self { loaded: HashMap::new() }
    }

    /// Load a WASM component from `path` under the given plugin id.
    /// Task 1 skeleton: records the id but does not instantiate a wasmtime component.
    pub fn load_component(
        &mut self,
        _path: &Path,
        plugin_id: &str,
        _permissions: Vec<String>,
        _workspace: Option<std::path::PathBuf>,
    ) -> AsterResult<()> {
        self.loaded.insert(plugin_id.to_string(), ());
        Ok(())
    }

    pub fn invoke(&self, plugin_id: &str, _command_id: &str, _params: &str) -> AsterResult<String> {
        if !self.loaded.contains_key(plugin_id) {
            return Err(AsterError::NotFound(format!("wasm plugin not loaded: {plugin_id}")));
        }
        Err(AsterError::PluginFailed("wasm invoke not yet implemented".into()))
    }

    pub fn transform(
        &mut self,
        plugin_id: &str,
        _hook: &str,
        _path: &str,
        _content: Vec<u8>,
    ) -> AsterResult<Vec<u8>> {
        if !self.loaded.contains_key(plugin_id) {
            return Err(AsterError::NotFound(format!("wasm plugin not loaded: {plugin_id}")));
        }
        Err(AsterError::PluginFailed("wasm transform not yet implemented".into()))
    }
}

impl Default for WasmHost {
    fn default() -> Self { Self::new() }
}
