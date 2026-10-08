use std::sync::Arc;
use std::path::Path;
use tauri::State;
use serde_json::Value;
use aster_core::{
    registry::CommandRegistry,
    document::DocumentService,
    workspace::WorkspaceService,
    commands::register_core_commands,
};
use crate::recovery;

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

/// Auto-save: write content to disk + keep a recovery copy.
/// Called from the frontend after a 1-second debounce on content change.
#[tauri::command]
pub async fn auto_save(
    path: String,
    content: String,
    expected_hash: Option<String>,
    state: State<'_, CoreState>,
) -> Result<Value, String> {
    // Write recovery copy in background (best-effort, don't block save)
    let path_clone = path.clone();
    let content_clone = content.clone();
    tokio::spawn(async move {
        recovery::write_recovery(Path::new(&path_clone), &content_clone).await;
    });

    // Actual atomic save via registry
    let params = serde_json::json!({
        "path": path,
        "content": content,
        "expectedHash": expected_hash,
    });
    let mut reg = state.registry.lock().unwrap();
    reg.dispatch("doc.write", params)
        .map_err(|e| format!("{}: {}", e.code(), e))
}
