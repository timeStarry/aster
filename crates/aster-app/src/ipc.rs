use aster_core::{
    commands::register_core_commands, document::DocumentService, plugin::PluginHost,
    registry::CommandRegistry, workspace::WorkspaceService,
};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Listener, Manager, State};

pub struct CoreState {
    pub registry: std::sync::Mutex<CommandRegistry>,
}

impl CoreState {
    pub fn new(host: Arc<std::sync::Mutex<PluginHost>>) -> Self {
        let mut reg = CommandRegistry::new();
        let doc = Arc::new(DocumentService::new());
        let ws = Arc::new(WorkspaceService::new());
        register_core_commands(&mut reg, doc, ws, host);
        Self {
            registry: std::sync::Mutex::new(reg),
        }
    }
}

#[tauri::command]
pub fn dispatch(
    id: String,
    params: Value,
    state: State<CoreState>,
    app: tauri::AppHandle,
) -> Result<Value, Value> {
    let mut reg = state
        .registry
        .lock()
        .map_err(|_| serde_json::json!({"code":"E_IO","message":"registry lock poisoned"}))?;
    dispatch_with_asset_scope(&mut reg, &id, params, |directory| {
        app.asset_protocol_scope()
            .allow_directory(directory, true)
            .map_err(|error| error.to_string())
    })
}

/// Allow relative images only after a document has been opened or saved.
/// A failed scope update must not turn an already committed save into an error.
fn dispatch_with_asset_scope(
    registry: &mut CommandRegistry,
    id: &str,
    params: Value,
    allow_directory: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<Value, Value> {
    let document_path = if matches!(id, "doc.read" | "doc.write") {
        params
            .get("path")
            .and_then(Value::as_str)
            .map(PathBuf::from)
    } else {
        None
    };
    let result = registry
        .dispatch(id, params)
        .map_err(|error| error.to_json())?;
    if let Some(path) = document_path {
        let granted = document_asset_directory(&path)
            .map_err(|error| error.to_string())
            .and_then(|directory| allow_directory(&directory));
        if let Err(error) = granted {
            eprintln!(
                "[aster-assets] failed to allow images for {}: {error}",
                path.display()
            );
        }
    }
    Ok(result)
}

fn document_asset_directory(document_path: &Path) -> std::io::Result<PathBuf> {
    // A filename without a directory is relative to the working directory.
    // Resolve only its parent, preserving the image base of symlinked documents.
    let parent = document_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    std::fs::canonicalize(parent)
}

/// Save `content` to `path` (atomic, with an optional optimistic-lock hash).
/// Unsaved work is protected separately by the session snapshot (recovery.rs).
#[tauri::command]
pub async fn auto_save(
    path: String,
    content: String,
    expected_hash: Option<String>,
    state: State<'_, CoreState>,
    app: tauri::AppHandle,
) -> Result<Value, Value> {
    // Actual atomic save via registry
    let params = serde_json::json!({
        "path": path.clone(),
        "content": content,
        "expectedHash": expected_hash,
    });
    let result = {
        let mut reg = state
            .registry
            .lock()
            .map_err(|_| serde_json::json!({"code":"E_IO","message":"registry lock poisoned"}))?;
        dispatch_with_asset_scope(&mut reg, "doc.write", params, |directory| {
            app.asset_protocol_scope()
                .allow_directory(directory, true)
                .map_err(|error| error.to_string())
        })?
    };

    Ok(result)
}

/// editor.openFile — tell the frontend to open a file in the editor.
/// Headless callers get E_NEEDS_GUI if the GUI is not running.
#[tauri::command]
pub async fn editor_open_file(path: String, app: tauri::AppHandle) -> Result<Value, Value> {
    app.emit("aster://editor/openFile", serde_json::json!({"path": path}))
        .map_err(|e| serde_json::json!({"code":"E_IO","message": e.to_string()}))?;
    Ok(serde_json::json!({"ok": true}))
}

/// editor.getSelection — ask the frontend for the current selection.
/// Returns { anchor: int, head: int, content: string }.
/// This fires an event and waits up to 2s for the frontend to reply via
/// a one-shot channel stored in state.
#[tauri::command]
pub async fn editor_get_selection(app: tauri::AppHandle) -> Result<Value, Value> {
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
    .map_err(
        |_| serde_json::json!({"code":"E_IO","message":"timeout waiting for editor selection"}),
    );

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
    app.emit(
        "aster://editor/insert",
        serde_json::json!({"text": text, "position": position}),
    )
    .map_err(|e| serde_json::json!({"code":"E_IO","message":e.to_string()}))?;
    Ok(serde_json::json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn document_registry() -> CommandRegistry {
        let mut registry = CommandRegistry::new();
        aster_core::commands::doc::register(&mut registry, Arc::new(DocumentService::new()));
        registry
    }

    #[test]
    fn opening_document_grants_only_its_directory() {
        let workspace = tempfile::TempDir::new().unwrap();
        let directory = workspace.path().join("含中文路径 [sample]");
        std::fs::create_dir(&directory).unwrap();
        let document = directory.join("走测样例.md");
        std::fs::write(&document, "![Aster](images/aster.png)").unwrap();

        let mut granted = None;
        let result = dispatch_with_asset_scope(
            &mut document_registry(),
            "doc.read",
            json!({ "path": document }),
            |path| {
                granted = Some(path.to_path_buf());
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(result["content"], "![Aster](images/aster.png)");
        let granted = granted.unwrap();
        assert_eq!(granted, std::fs::canonicalize(&directory).unwrap());
        assert_ne!(granted, std::fs::canonicalize(workspace.path()).unwrap());
    }

    #[test]
    fn committed_save_succeeds_even_if_asset_grant_fails() {
        let workspace = tempfile::TempDir::new().unwrap();
        let save_as = workspace.path().join("另存为.md");
        let mut attempted = false;
        let result = dispatch_with_asset_scope(
            &mut document_registry(),
            "doc.write",
            json!({ "path": save_as, "content": "![Aster](images/aster.png)" }),
            |path| {
                attempted = true;
                assert_eq!(path, std::fs::canonicalize(workspace.path()).unwrap());
                Err("simulated asset scope failure".into())
            },
        )
        .unwrap();

        assert!(attempted);
        assert_eq!(
            std::fs::read_to_string(save_as).unwrap(),
            "![Aster](images/aster.png)"
        );
        assert_eq!(result["hash"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn failed_document_commands_do_not_grant_assets() {
        let workspace = tempfile::TempDir::new().unwrap();
        let missing = workspace.path().join("missing.md");
        let mut registry = document_registry();
        let error = dispatch_with_asset_scope(
            &mut registry,
            "doc.read",
            json!({ "path": missing }),
            |_| panic!("failed read must not grant assets"),
        )
        .unwrap_err();
        assert_eq!(error["code"], "E_NOT_FOUND");

        let document = workspace.path().join("existing.md");
        std::fs::write(&document, "original").unwrap();
        let error = dispatch_with_asset_scope(
            &mut registry,
            "doc.write",
            json!({ "path": document, "content": "replacement", "expectedHash": "stale" }),
            |_| panic!("failed write must not grant assets"),
        )
        .unwrap_err();
        assert_eq!(error["code"], "E_CONFLICT");
        assert_eq!(std::fs::read_to_string(&document).unwrap(), "original");

        let result = dispatch_with_asset_scope(
            &mut registry,
            "doc.outline",
            json!({ "path": document }),
            |_| panic!("other commands must not grant assets"),
        )
        .unwrap();
        assert!(result.is_array());
    }

    #[test]
    fn bare_filename_resolves_to_the_current_directory() {
        assert_eq!(
            document_asset_directory(Path::new("relative.md")).unwrap(),
            std::fs::canonicalize(".").unwrap()
        );
    }
}
