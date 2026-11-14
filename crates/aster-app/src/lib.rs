mod assets;
mod backup;
mod fonts;
mod ipc;
mod links;
mod menu;
mod recovery;
mod rpc;
mod shell;
mod updater;

use aster_core::{
    plugin::{PluginHost, PluginSource},
    watcher::DocumentWatcher,
};
use ipc::CoreState;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

struct PendingOpenState {
    ready: bool,
    files: Vec<String>,
}

#[derive(Clone)]
pub struct PendingOpenFiles(Arc<Mutex<PendingOpenState>>);

impl PendingOpenFiles {
    fn from_cli_args() -> Self {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut files = Vec::new();
        for arg in std::env::args().skip(1) {
            if arg.starts_with('-') {
                continue;
            }
            let p = PathBuf::from(&arg);
            let abs = if p.is_absolute() { p } else { cwd.join(p) };
            if is_openable_doc_arg(&abs) {
                let resolved = std::fs::canonicalize(&abs).unwrap_or(abs);
                files.push(resolved.to_string_lossy().into_owned());
            }
        }
        Self(Arc::new(Mutex::new(PendingOpenState {
            ready: false,
            files,
        })))
    }

    fn drain_and_mark_ready(&self) -> Vec<String> {
        if let Ok(mut guard) = self.0.lock() {
            guard.ready = true;
            std::mem::take(&mut guard.files)
        } else {
            Vec::new()
        }
    }

    fn push_or_emit(&self, app: &tauri::AppHandle, path: String) {
        let should_emit = if let Ok(mut guard) = self.0.lock() {
            if guard.ready {
                true
            } else {
                if !guard.files.contains(&path) {
                    guard.files.push(path.clone());
                }
                false
            }
        } else {
            true
        };

        if should_emit {
            use tauri::{Emitter, Manager};
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            let _ = app.emit("aster://editor/openFile", serde_json::json!({ "path": path }));
        }
    }
}

fn is_openable_doc_arg(path: &Path) -> bool {
    if path.is_file() {
        return true;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd" | "txt"
            )
        })
        .unwrap_or(false)
}

#[tauri::command]
fn take_startup_files(pending: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    pending.drain_and_mark_ready()
}

pub fn run() {
    let context = {
        let mut context = tauri::generate_context!();
        // Configure native material before the first frame is shown. Only the
        // native desktop platforms use transparency; Linux keeps its solid shell.
        if let Some(main) = context
            .config_mut()
            .app
            .windows
            .iter_mut()
            .find(|w| w.label == "main")
        {
            main.visible = false;
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                main.transparent = true;
            }
            #[cfg(target_os = "windows")]
            {
                main.no_redirection_bitmap = true;
            }
        }
        context
    };

    let plugin_host = {
        let h = PluginHost::new().expect("plugin host init failed");
        Arc::new(std::sync::Mutex::new(h))
    };

    let state = CoreState::new(Arc::clone(&plugin_host));
    let pending_files = PendingOpenFiles::from_cli_args();
    let pending_for_run = pending_files.clone();
    let reg_for_setup = Arc::clone(&state.registry);
    let watcher_for_setup = Arc::clone(&state.watcher);
    let host_for_setup = Arc::clone(&plugin_host);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(|app| menu::build(app, menu::Lang::En))
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()))
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            {
                app.hide_menu()?;
            }
            {
                use tauri::Manager;
                if let Some(main) = app.get_webview_window("main") {
                    shell::initialize(main)?;
                }
            }

            // Load unified Flagship built-in plugins (packaged resource dir or dev repo `plugins/`),
            // followed by user plugins (`~/.aster/plugins`) which can override built-in ids.
            {
                use tauri::Manager;
                let bundled_dir = app
                    .path()
                    .resource_dir()
                    .ok()
                    .map(|r| r.join("bundled-plugins"))
                    .filter(|d| d.is_dir())
                    .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins"));
                let user_dir = dirs::home_dir()
                    .unwrap_or_default()
                    .join(".aster/plugins");
                if let Ok(mut h) = host_for_setup.lock() {
                    if bundled_dir.is_dir() {
                        if let Err(e) = h.load_dir(&bundled_dir, PluginSource::Builtin) {
                            eprintln!(
                                "[aster-plugins] failed to load bundled plugins from {}: {e}",
                                bundled_dir.display()
                            );
                        }
                    }
                    let _ = h.load_dir(&user_dir, PluginSource::User);
                }
            }

            // Start the `notify` document watcher and forward external disk edits to the frontend.
            {
                use tauri::Emitter;
                let app_emit = app.handle().clone();
                let watcher = Arc::new(DocumentWatcher::new(move |evt| {
                    let _ = app_emit.emit("aster://file/changed", evt);
                }));
                if let Ok(mut slot) = watcher_for_setup.lock() {
                    *slot = Some(watcher);
                }
            }

            // Register live GUI `editor.*` handlers into the shared registry, then launch
            // the JSON-RPC server on that same registry and keep its handle alive.
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    {
                        let mut reg = reg_for_setup.lock().await;
                        ipc::register_gui_editor_handlers(&mut reg, app_handle);
                    }
                    let _server = rpc::start_rpc_server(reg_for_setup).await;
                    std::future::pending::<()>().await;
                });
            }

            Ok(())
        })
        .manage(state)
        .manage(pending_files)
        .invoke_handler(tauri::generate_handler![
            ipc::dispatch,
            ipc::auto_save,
            ipc::unwatch_file,
            ipc::editor_open_file,
            ipc::editor_get_selection,
            ipc::editor_insert,
            take_startup_files,
            assets::asset_save_bytes,
            assets::asset_copy_file,
            assets::asset_migrate_draft,
            assets::export_write_file,
            menu::set_menu_language,
            fonts::fonts_list,
            links::open_repo,
            links::open_external_url,
            recovery::draft_save,
            recovery::draft_read,
            recovery::draft_delete,
            recovery::session_save_v2,
            recovery::session_load_v2,
            recovery::session_save,
            recovery::session_take,
            recovery::session_clear,
            backup::settings_file_read,
            backup::settings_file_write,
            shell::configure_shell,
            updater::update_check,
            updater::update_download_and_install,
            updater::update_relaunch,
        ])
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let sock = rpc::socket_path();
                let _ = std::fs::remove_file(&sock);
            }
        })
        .build(context)
        .expect("error while building tauri application");

    app.run(move |app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    pending_for_run.push_or_emit(app_handle, path.to_string_lossy().into_owned());
                }
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        let _ = (app_handle, event, &pending_for_run);
    });
}
