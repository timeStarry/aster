use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::error::{AsterError, AsterResult};

// ── Permission context ────────────────────────────────────────────────────────

pub struct HostContext {
    permissions: Vec<String>,
    workspace: Option<PathBuf>,
}

impl HostContext {
    pub fn new(permissions: Vec<String>, workspace: Option<PathBuf>) -> Self {
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

// ── wasmtime bindgen! ─────────────────────────────────────────────────────────

wasmtime::component::bindgen!({
    world: "plugin",
    path: "../../wit/aster-plugin.wit",
    async: false,
});

// ── WASI + host-function state ────────────────────────────────────────────────

struct PluginState {
    ctx: HostContext,
    wasi: wasmtime_wasi::WasiCtx,
    table: wasmtime::component::ResourceTable,
}

impl wasmtime_wasi::WasiView for PluginState {
    fn ctx(&mut self) -> &mut wasmtime_wasi::WasiCtx { &mut self.wasi }
    fn table(&mut self) -> &mut wasmtime::component::ResourceTable { &mut self.table }
}

impl aster::plugin::host::Host for PluginState {
    fn read_file(&mut self, path: String) -> Result<Vec<u8>, String> {
        self.ctx.check_read_permission(&path).map_err(|e| e.to_string())?;
        std::fs::read(&path).map_err(|e| e.to_string())
    }

    fn write_file(&mut self, path: String, data: Vec<u8>) -> Result<(), String> {
        self.ctx.check_write_permission(&path).map_err(|e| e.to_string())?;
        std::fs::write(&path, &data).map_err(|e| e.to_string())
    }

    fn http_request(&mut self, _url: String, _method: String, _body: Vec<u8>) -> Result<Vec<u8>, String> {
        Err("http-request not implemented in M4".into())
    }

    fn log(&mut self, level: String, msg: String) {
        eprintln!("[wasm-plugin][{level}] {msg}");
    }
}

// ── Loaded plugin wrapper ─────────────────────────────────────────────────────

struct LoadedPlugin {
    instance: Plugin,
    store: wasmtime::Store<PluginState>,
}

// ── WasmHost ──────────────────────────────────────────────────────────────────

pub struct WasmHost {
    engine: wasmtime::Engine,
    plugins: HashMap<String, LoadedPlugin>,
}

impl WasmHost {
    pub fn new() -> Self {
        let mut config = wasmtime::Config::new();
        config.wasm_component_model(true);
        let engine = wasmtime::Engine::new(&config)
            .expect("wasmtime engine initialisation failed");
        Self { engine, plugins: HashMap::new() }
    }

    /// Load and instantiate a WASM component from `path`.
    pub fn load_component(
        &mut self,
        path: &Path,
        plugin_id: &str,
        permissions: Vec<String>,
        workspace: Option<PathBuf>,
    ) -> AsterResult<()> {
        use wasmtime::component::{Component, Linker};

        let component = Component::from_file(&self.engine, path)
            .map_err(|e| AsterError::PluginFailed(format!("component load: {e}")))?;

        let mut linker: Linker<PluginState> = Linker::new(&self.engine);

        // Wire host interface
        aster::plugin::host::add_to_linker(&mut linker, |s| s)
            .map_err(|e| AsterError::PluginFailed(e.to_string()))?;

        // Wire WASI
        wasmtime_wasi::add_to_linker_sync::<PluginState>(&mut linker)
            .map_err(|e| AsterError::PluginFailed(e.to_string()))?;

        let wasi = wasmtime_wasi::WasiCtxBuilder::new().build();
        let table = wasmtime::component::ResourceTable::new();
        let state = PluginState { ctx: HostContext::new(permissions, workspace), wasi, table };
        let mut store = wasmtime::Store::new(&self.engine, state);

        let instance = Plugin::instantiate(&mut store, &component, &linker)
            .map_err(|e| AsterError::PluginFailed(format!("instantiate: {e}")))?;

        // Call activate with empty settings
        instance.interface0.call_activate(&mut store, "{}")
            .map_err(|e| AsterError::PluginFailed(e.to_string()))?
            .map_err(|e| AsterError::PluginFailed(e))?;

        self.plugins.insert(plugin_id.to_string(), LoadedPlugin { instance, store });
        Ok(())
    }

    pub fn invoke(&self, plugin_id: &str, _command_id: &str, _params: &str) -> AsterResult<String> {
        if !self.plugins.contains_key(plugin_id) {
            return Err(AsterError::NotFound(format!("wasm plugin not loaded: {plugin_id}")));
        }
        Err(AsterError::PluginFailed("invoke requires &mut self — use invoke_mut".into()))
    }

    pub fn invoke_mut(&mut self, plugin_id: &str, command_id: &str, params: &str) -> AsterResult<String> {
        let p = self.plugins.get_mut(plugin_id)
            .ok_or_else(|| AsterError::NotFound(format!("wasm plugin not loaded: {plugin_id}")))?;
        p.instance.interface0.call_invoke(&mut p.store, command_id, params)
            .map_err(|e| AsterError::PluginFailed(e.to_string()))?
            .map_err(|e| AsterError::PluginFailed(e))
    }

    pub fn transform(
        &mut self,
        plugin_id: &str,
        hook: &str,
        path: &str,
        content: Vec<u8>,
    ) -> AsterResult<Vec<u8>> {
        let p = self.plugins.get_mut(plugin_id)
            .ok_or_else(|| AsterError::NotFound(format!("wasm plugin not loaded: {plugin_id}")))?;
        p.instance.interface0.call_transform(&mut p.store, hook, path, &content)
            .map_err(|e| AsterError::PluginFailed(e.to_string()))?
            .map_err(|e| AsterError::PluginFailed(e))
    }
}

impl Default for WasmHost {
    fn default() -> Self { Self::new() }
}
