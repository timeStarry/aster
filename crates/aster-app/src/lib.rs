mod ipc;
mod recovery;
use ipc::CoreState;

pub fn run() {
    tauri::Builder::default()
        .manage(CoreState::new())
        .invoke_handler(tauri::generate_handler![
            ipc::dispatch,
            ipc::auto_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
