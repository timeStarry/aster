use aster_core::{
    commands::register_core_commands,
    document::DocumentService,
    error::AsterError,
    plugin::PluginHost,
    registry::{CommandRegistry, CommandSpec},
    watcher::DocumentWatcher,
    workspace::WorkspaceService,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Listener, Manager, State};

pub type SharedWatcherSlot = Arc<std::sync::Mutex<Option<Arc<DocumentWatcher>>>>;

/// Single unified application kernel state shared by Tauri IPC and the JSON-RPC server.
pub struct CoreState {
    pub registry: Arc<tokio::sync::Mutex<CommandRegistry>>,
    pub doc: Arc<DocumentService>,
    pub watcher: SharedWatcherSlot,
}

impl CoreState {
    pub fn new(host: Arc<std::sync::Mutex<PluginHost>>) -> Self {
        let mut reg = CommandRegistry::new();
        let doc = Arc::new(DocumentService::new());
        let ws = Arc::new(WorkspaceService::new());
        register_core_commands(&mut reg, Arc::clone(&doc), ws, host);

        let watcher: SharedWatcherSlot = Arc::new(std::sync::Mutex::new(None));

        // Wrap doc.write & doc.patch so external RPC/MCP writes immediately notify the watcher.
        wrap_external_write_notifications(&mut reg, Arc::clone(&watcher));

        Self {
            registry: Arc::new(tokio::sync::Mutex::new(reg)),
            doc,
            watcher,
        }
    }

    pub fn get_watcher(&self) -> Option<Arc<DocumentWatcher>> {
        self.watcher.lock().ok().and_then(|g| g.clone())
    }
}

fn wrap_external_write_notifications(
    registry: &mut CommandRegistry,
    watcher_slot: SharedWatcherSlot,
) {
    for cmd_id in ["doc.write", "doc.patch"] {
        let Some(spec) = registry.get(cmd_id).cloned() else { continue };
        let Ok(inner_handler) = registry.handler(cmd_id) else { continue };
        let ws = Arc::clone(&watcher_slot);
        registry.register_with_handler(spec, move |params| {
            let path_opt = params.get("path").and_then(Value::as_str).map(PathBuf::from);
            let res = inner_handler(params)?;
            if let Some(p) = path_opt {
                if let Some(w) = ws.lock().ok().and_then(|g| g.clone()) {
                    w.notify_external_write(&p);
                }
            }
            Ok(res)
        });
    }
}

/// Bind live GUI handlers for `editor.openFile`, `editor.getSelection`, and `editor.insert`
/// into the shared `CommandRegistry` so JSON-RPC / MCP callers drive the open editor window.
pub fn register_gui_editor_handlers(registry: &mut CommandRegistry, app: tauri::AppHandle) {
    // editor.openFile
    {
        let app_h = app.clone();
        registry.register_with_handler(
            CommandSpec {
                id: "editor.openFile".into(),
                description: "Open a file in the GUI editor".into(),
                params_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
                returns_schema: json!({"type":"object","properties":{"ok":{"type":"boolean"}}}),
                headless: false,
                source: "core".into(),
            },
            move |params| {
                let path = params
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AsterError::InvalidParams("missing field: path".into()))?;
                if let Some(win) = app_h.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
                app_h
                    .emit("aster://editor/openFile", json!({ "path": path }))
                    .map_err(|e| AsterError::Io(e.to_string()))?;
                Ok(json!({ "ok": true }))
            },
        );
    }

    // editor.getSelection
    {
        let app_h = app.clone();
        registry.register_with_handler(
            CommandSpec {
                id: "editor.getSelection".into(),
                description: "Return the current editor selection { anchor, head, content }".into(),
                params_schema: json!({"type":"object"}),
                returns_schema: json!({"type":"object","properties":{"anchor":{"type":"integer"},"head":{"type":"integer"},"content":{"type":"string"}}}),
                headless: false,
                source: "core".into(),
            },
            move |_params| {
                let (tx, rx) = std::sync::mpsc::sync_channel::<Value>(1);
                let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
                let listener_id = app_h.listen("aster://editor/selectionResult", {
                    let tx = Arc::clone(&tx);
                    move |evt| {
                        if let Ok(mut guard) = tx.lock() {
                            if let Some(sender) = guard.take() {
                                let payload: Value =
                                    serde_json::from_str(evt.payload()).unwrap_or(Value::Null);
                                let _ = sender.send(payload);
                            }
                        }
                    }
                });

                if let Err(e) = app_h.emit("aster://editor/getSelection", json!({})) {
                    app_h.unlisten(listener_id);
                    return Err(AsterError::Io(e.to_string()));
                }

                let res = rx
                    .recv_timeout(Duration::from_secs(2))
                    .map_err(|_| AsterError::Io("timeout waiting for editor selection".into()));
                app_h.unlisten(listener_id);
                res
            },
        );
    }

    // editor.insert
    {
        let app_h = app;
        registry.register_with_handler(
            CommandSpec {
                id: "editor.insert".into(),
                description: "Insert text at the cursor or at a specified position".into(),
                params_schema: json!({"type":"object","properties":{"text":{"type":"string"},"position":{"type":"integer"}},"required":["text"]}),
                returns_schema: json!({"type":"object","properties":{"ok":{"type":"boolean"}}}),
                headless: false,
                source: "core".into(),
            },
            move |params| {
                let text = params
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AsterError::InvalidParams("missing field: text".into()))?;
                let position = params.get("position").cloned();
                app_h
                    .emit(
                        "aster://editor/insert",
                        json!({ "text": text, "position": position }),
                    )
                    .map_err(|e| AsterError::Io(e.to_string()))?;
                Ok(json!({ "ok": true }))
            },
        );
    }
}

#[tauri::command]
pub async fn dispatch(
    id: String,
    params: Value,
    state: State<'_, CoreState>,
    app: tauri::AppHandle,
) -> Result<Value, Value> {
    let document_path = if matches!(id.as_str(), "doc.read" | "doc.write") {
        params
            .get("path")
            .and_then(Value::as_str)
            .map(PathBuf::from)
    } else {
        None
    };

    let handler = {
        let reg = state.registry.lock().await;
        reg.handler(&id).map_err(|e| e.to_json())?
    };

    let result = tokio::task::spawn_blocking(move || handler(params))
        .await
        .map_err(|e| json!({"code": "E_IO", "message": e.to_string()}))?
        .map_err(|e| e.to_json())?;

    if let Some(path) = document_path {
        grant_asset_directory_for(&app, &path);
        if id == "doc.read" {
            let lossy = result.get("encodingLossy").and_then(Value::as_bool).unwrap_or(false);
            if !lossy {
                if let (Some(w), Some(h)) = (state.get_watcher(), result.get("hash").and_then(Value::as_str)) {
                    w.watch(&path, h);
                }
            }
        } else if id == "doc.write" {
            if let (Some(w), Some(h)) = (state.get_watcher(), result.get("hash").and_then(Value::as_str)) {
                w.record_self_write(&path, h);
            }
        }
    }

    Ok(result)
}

fn grant_asset_directory_for(app: &tauri::AppHandle, path: &Path) {
    let granted = document_asset_directory(path)
        .map_err(|error| error.to_string())
        .and_then(|directory| {
            app.asset_protocol_scope()
                .allow_directory(&directory, true)
                .map_err(|error| error.to_string())
        });
    if let Err(error) = granted {
        eprintln!(
            "[aster-assets] failed to allow images for {}: {error}",
            path.display()
        );
    }
}

/// Allow relative images only after a document has been opened or saved.
/// A failed scope update must not turn an already committed save into an error.
#[cfg(test)]
pub fn dispatch_with_asset_scope(
    registry: &CommandRegistry,
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
    let parent = document_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    std::fs::canonicalize(parent)
}

/// Save `content` to `path` (atomic, with an optional optimistic-lock hash)
/// and record the resulting hash as a self-write so the file watcher does not echo it back.
#[tauri::command]
pub async fn auto_save(
    path: String,
    content: String,
    expected_hash: Option<String>,
    state: State<'_, CoreState>,
    app: tauri::AppHandle,
) -> Result<Value, Value> {
    let doc = Arc::clone(&state.doc);
    let path_buf = PathBuf::from(&path);
    let write_path = path_buf.clone();
    let new_hash = tokio::task::spawn_blocking(move || {
        doc.write(&write_path, &content, expected_hash.as_deref())
    })
    .await
    .map_err(|e| json!({"code": "E_IO", "message": e.to_string()}))?
    .map_err(|e| e.to_json())?;

    if let Some(w) = state.get_watcher() {
        w.record_self_write(&path_buf, &new_hash);
    }
    grant_asset_directory_for(&app, &path_buf);

    Ok(json!({ "hash": new_hash }))
}

/// Stop watching a closed tab's file path.
#[tauri::command]
pub fn unwatch_file(path: String, state: State<'_, CoreState>) {
    if let Some(w) = state.get_watcher() {
        w.unwatch(Path::new(&path));
    }
}

#[tauri::command]
pub async fn editor_open_file(path: String, app: tauri::AppHandle) -> Result<Value, Value> {
    app.emit("aster://editor/openFile", json!({"path": path}))
        .map_err(|e| json!({"code":"E_IO","message": e.to_string()}))?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub async fn editor_get_selection(app: tauri::AppHandle) -> Result<Value, Value> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
    let tx = Arc::new(std::sync::Mutex::new(Some(tx)));

    let listener_id = app.listen("aster://editor/selectionResult", {
        let tx = Arc::clone(&tx);
        move |evt| {
            if let Ok(mut guard) = tx.lock() {
                if let Some(sender) = guard.take() {
                    let payload: Value = serde_json::from_str(evt.payload()).unwrap_or(Value::Null);
                    let _ = sender.send(payload);
                }
            }
        }
    });

    app.emit("aster://editor/getSelection", json!({}))
        .map_err(|e| {
            app.unlisten(listener_id);
            json!({"code":"E_IO","message":e.to_string()})
        })?;

    let result = tokio::time::timeout(Duration::from_secs(2), async move {
        rx.await.unwrap_or(Value::Null)
    })
    .await
    .map_err(|_| json!({"code":"E_IO","message":"timeout waiting for editor selection"}));

    app.unlisten(listener_id);
    result
}

#[tauri::command]
pub async fn editor_insert(
    text: String,
    position: Option<Value>,
    app: tauri::AppHandle,
) -> Result<Value, Value> {
    app.emit(
        "aster://editor/insert",
        json!({"text": text, "position": position}),
    )
    .map_err(|e| json!({"code":"E_IO","message":e.to_string()}))?;
    Ok(json!({"ok": true}))
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
            &document_registry(),
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
            &document_registry(),
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
        let registry = document_registry();
        let error = dispatch_with_asset_scope(
            &registry,
            "doc.read",
            json!({ "path": missing }),
            |_| panic!("failed read must not grant assets"),
        )
        .unwrap_err();
        assert_eq!(error["code"], "E_NOT_FOUND");

        let document = workspace.path().join("existing.md");
        std::fs::write(&document, "original").unwrap();
        let error = dispatch_with_asset_scope(
            &registry,
            "doc.write",
            json!({ "path": document, "content": "replacement", "expectedHash": "stale" }),
            |_| panic!("failed write must not grant assets"),
        )
        .unwrap_err();
        assert_eq!(error["code"], "E_CONFLICT");
        assert_eq!(std::fs::read_to_string(&document).unwrap(), "original");

        let result = dispatch_with_asset_scope(
            &registry,
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

    #[tokio::test]
    async fn single_core_state_shares_registry_across_layers() {
        let host = Arc::new(std::sync::Mutex::new(PluginHost::new().unwrap()));
        let state = CoreState::new(host);
        let reg = state.registry.lock().await;
        // Both config.*, doc.*, and editor.* commands are registered in the single registry
        assert!(reg.get("config.get").is_some());
        assert!(reg.get("doc.read").is_some());
        assert!(reg.get("editor.openFile").is_some());
    }
}
