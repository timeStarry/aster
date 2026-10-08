use std::sync::Arc;
use std::path::Path;
use tauri::{State, Emitter, Listener};
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
) -> Result<Value, Value> {
    let mut reg = state.registry.lock()
        .map_err(|_| serde_json::json!({"code":"E_IO","message":"registry lock poisoned"}))?;
    reg.dispatch(&id, params).map_err(|e| e.to_json())
}

/// Auto-save: write content to disk + keep a recovery copy.
/// Called from the frontend after a 1-second debounce on content change.
#[tauri::command]
pub async fn auto_save(
    path: String,
    content: String,
    expected_hash: Option<String>,
    state: State<'_, CoreState>,
) -> Result<Value, Value> {
    // Write recovery copy in background (best-effort, don't block save)
    let path_clone = path.clone();
    let content_clone = content.clone();
    tokio::spawn(async move {
        recovery::write_recovery(Path::new(&path_clone), &content_clone).await;
    });

    // Actual atomic save via registry
    let params = serde_json::json!({
        "path": path.clone(),
        "content": content,
        "expectedHash": expected_hash,
    });
    let result = {
        let mut reg = state.registry.lock()
            .map_err(|_| serde_json::json!({"code":"E_IO","message":"registry lock poisoned"}))?;
        reg.dispatch("doc.write", params).map_err(|e| e.to_json())?
    };

    // Clean save succeeded — remove stale recovery file so crash-recovery
    // doesn't restore an outdated version.
    recovery::remove_recovery(Path::new(&path)).await;

    Ok(result)
}

/// editor.openFile — tell the frontend to open a file in the editor.
/// Headless callers get E_NEEDS_GUI if the GUI is not running.
#[tauri::command]
pub async fn editor_open_file(
    path: String,
    app: tauri::AppHandle,
) -> Result<Value, Value> {
    app.emit("aster://editor/openFile", serde_json::json!({"path": path}))
        .map_err(|e| serde_json::json!({"code":"E_IO","message": e.to_string()}))?;
    Ok(serde_json::json!({"ok": true}))
}

/// editor.getSelection — ask the frontend for the current selection.
/// Returns { anchor: int, head: int, content: string }.
/// This fires an event and waits up to 2s for the frontend to reply via
/// a one-shot channel stored in state.
#[tauri::command]
pub async fn editor_get_selection(
    app: tauri::AppHandle,
) -> Result<Value, Value> {
    // Emit the request; the frontend emits "aster://editor/selectionResult"
    // back. We use a one-shot tokio channel with a 2s timeout.
    let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    let listener_id = app.listen("aster://editor/selectionResult", {
        let tx = std::sync::Arc::clone(&tx);
        move |evt| {
            if let Some(sender) = tx.lock().unwrap().take() {
                let payload: Value = serde_json::from_str(evt.payload()).unwrap_or(Value::Null);
                let _ = sender.send(payload);
            }
        }
    });

    app.emit("aster://editor/getSelection", serde_json::json!({}))
        .map_err(|e| {
            app.unlisten(listener_id);
            serde_json::json!({"code":"E_IO","message":e.to_string()})
        })?;

    let result = tokio::time::timeout(std::time::Duration::from_secs(2), async move {
        rx.await.unwrap_or(Value::Null)
    })
    .await
    .map_err(|_| serde_json::json!({"code":"E_IO","message":"timeout waiting for editor selection"}));

    app.unlisten(listener_id);
    result
}

/// editor.insert — insert text at the current cursor position (or at a specified offset).
#[tauri::command]
pub async fn editor_insert(
    text: String,
    position: Option<Value>,
    app: tauri::AppHandle,
) -> Result<Value, Value> {
    app.emit("aster://editor/insert", serde_json::json!({"text": text, "position": position}))
        .map_err(|e| serde_json::json!({"code":"E_IO","message":e.to_string()}))?;
    Ok(serde_json::json!({"ok": true}))
}
