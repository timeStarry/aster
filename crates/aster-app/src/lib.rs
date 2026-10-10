mod fonts;
mod ipc;
mod menu;
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
    let rpc_handle = tauri::async_runtime::spawn(async move {
        rpc::start_rpc_server(reg_clone).await
    });

    #[cfg(feature = "bundled-plugins")]
    let builtin_host = Arc::clone(&plugin_host);
    let state = CoreState::new(plugin_host);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(|app| menu::build(app, menu::Lang::En))
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()))
        .setup(move |_app| {
            #[cfg(feature = "bundled-plugins")]
            {
                use tauri::Manager;
                if let Ok(res) = _app.path().resource_dir() {
                    let dir = res.join("bundled-plugins");
                    if let Ok(mut h) = builtin_host.lock() {
                        if let Err(e) = h.load_dir(&dir, aster_core::plugin::PluginSource::Builtin) {
                            eprintln!("[aster-plugins] failed to load bundled plugins from {}: {e}", dir.display());
                        }
                    }
                }
            }
            Ok(())
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            ipc::dispatch,
            ipc::auto_save,
            ipc::editor_open_file,
            ipc::editor_get_selection,
            ipc::editor_insert,
            menu::set_menu_language,
            fonts::fonts_list,
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
