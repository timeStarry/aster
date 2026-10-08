mod ipc;
mod recovery;
mod rpc;
use ipc::CoreState;
use std::sync::Arc;
use tokio::sync::Mutex;
use aster_core::{
    document::DocumentService,
    workspace::WorkspaceService,
    registry::CommandRegistry,
    commands::register_core_commands,
};

pub fn run() {
    // Build a shared registry for both the Tauri IPC layer and the RPC server
    let reg = {
        let mut r = CommandRegistry::new();
        let doc = Arc::new(DocumentService::new());
        let ws = Arc::new(WorkspaceService::new());
        register_core_commands(&mut r, doc, ws);
        Arc::new(Mutex::new(r))
    };

    // Start the JSON-RPC socket server in the background (best-effort)
    let reg_clone = Arc::clone(&reg);
    let rpc_handle = {
        let rt = tokio::runtime::Handle::current();
        // We're inside Tauri's async runtime; just spawn
        Some(rt.spawn(async move {
            rpc::start_rpc_server(reg_clone).await
        }))
    };

    // The CoreState wraps its own Mutex<CommandRegistry> (sync) for Tauri IPC.
    // For simplicity we keep the two registries in sync: both are initialised
    // identically and both execute headless commands. The RPC registry has an
    // Arc<Mutex> (async); the Tauri IPC one uses std::Mutex for synchronous
    // Tauri command context.
    let state = CoreState::new();

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
                // Best-effort: remove socket file on last window close
                let sock = rpc::socket_path();
                let _ = std::fs::remove_file(&sock);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Ensure rpc_handle binding is kept alive (compiler won't drop it early)
    drop(rpc_handle);
}
