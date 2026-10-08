use std::sync::Arc;
use tauri::State;
use serde_json::Value;
use aster_core::{
    registry::CommandRegistry,
    document::DocumentService,
    workspace::WorkspaceService,
    commands::register_core_commands,
};

pub struct CoreState {
    pub registry: std::sync::Mutex<CommandRegistry>,
}

impl CoreState {
    pub fn new() -> Self {
        let mut reg = CommandRegistry::new();
        let doc = Arc::new(DocumentService::new());
        let ws = Arc::new(WorkspaceService::new());
        register_core_commands(&mut reg, doc, ws);
        Self { registry: std::sync::Mutex::new(reg) }
    }
}

#[tauri::command]
pub fn dispatch(
    id: String,
    params: Value,
    state: State<CoreState>,
) -> Result<Value, String> {
    let mut reg = state.registry.lock().unwrap();
    reg.dispatch(&id, params).map_err(|e| format!("{}: {}", e.code(), e))
}
