mod ipc;
mod recovery;
mod rpc;
use ipc::CoreState;
use std::sync::Arc;
use tokio::sync::Mutex;
use aster_core::{
    document::DocumentService,
    workspace::WorkspaceService,
    plugin::PluginHost,
    registry::CommandRegistry,
    commands::register_core_commands,
};

pub fn run() {
    // Build shared PluginHost, loading builtin and user plugins
    let plugin_host = {
        let mut h = PluginHost::new().expect("wasmtime init failed");
        #[cfg(feature = "bundled-plugins")]
        {
            let bundled = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("bundled-plugins")));
            if let Some(dir) = bundled {
                let _ = h.load_dir(&dir, aster_core::plugin::PluginSource::Builtin);
            }
        }
        let user_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".aster/plugins");
        let _ = h.load_dir(&user_dir, aster_core::plugin::PluginSource::User);
        Arc::new(std::sync::Mutex::new(h))
    };

    // Build a shared registry for both the Tauri IPC layer and the RPC server
    let reg = {
        let mut r = CommandRegistry::new();
        let doc = Arc::new(DocumentService::new());
        let ws = Arc::new(WorkspaceService::new());
        register_core_commands(&mut r, doc, ws, Arc::clone(&plugin_host));
        Arc::new(Mutex::new(r))
    };

    // Start the JSON-RPC socket server in the background (best-effort)
    let reg_clone = Arc::clone(&reg);
    let rpc_handle = {
        let rt = tokio::runtime::Handle::current();
        Some(rt.spawn(async move {
            rpc::start_rpc_server(reg_clone).await
        }))
    };

    let state = CoreState::new(plugin_host);

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            ipc::dispatch,
            ipc::auto_save,
            ipc::editor_open_file,
            ipc::editor_get_selection,
            ipc::editor_insert,
        ])
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let sock = rpc::socket_path();
                let _ = std::fs::remove_file(&sock);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    drop(rpc_handle);
}
