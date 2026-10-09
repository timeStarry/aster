use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// Native menu. Every custom item emits `aster://menu` with its id; the
/// frontend owns the behavior so menu and keyboard shortcuts share one path.
///
/// Formatting commands are deliberately not given menu accelerators: the
/// editor keymap already handles them, and a menu accelerator firing as well
/// would apply toggles (e.g. bold) twice.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        MenuItem::with_id(app, id, label, true, accel)
    };
    let sep = || PredefinedMenuItem::separator(app);

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("new", "New Tab", Some("CmdOrCtrl+N"))?,
            &item("open", "Open…", Some("CmdOrCtrl+O"))?,
            &sep()?,
            &item("save", "Save", Some("CmdOrCtrl+S"))?,
            &item("saveAs", "Save As…", Some("CmdOrCtrl+Shift+S"))?,
            &item("exportPdf", "Export as PDF…", None)?,
            &sep()?,
            &item("close", "Close Tab", Some("CmdOrCtrl+W"))?,
            #[cfg(not(target_os = "macos"))]
            &sep()?,
            #[cfg(not(target_os = "macos"))]
            &item("settings", "Settings…", Some("CmdOrCtrl+,"))?,
            #[cfg(not(target_os = "macos"))]
            &item("quit", "Quit", Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    // Predefined clipboard items are required on macOS for ⌘C/⌘V to reach the
    // webview. Undo/redo arrive in CodeMirror as historyUndo/historyRedo input
    // events, which its history extension handles.
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &sep()?,
            &item("find", "Find…", Some("CmdOrCtrl+F"))?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("modeLive", "Live Preview", None)?,
            &item("modeSource", "Source", None)?,
            &item("toggleMode", "Toggle Live / Source", Some("CmdOrCtrl+/"))?,
            &sep()?,
            &item("toggleLock", "Toggle Read-only", Some("CmdOrCtrl+Alt+L"))?,
            &sep()?,
            &item("nextTab", "Next Tab", Some("Ctrl+Tab"))?,
            &item("prevTab", "Previous Tab", Some("Ctrl+Shift+Tab"))?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        // Quit is a custom item (not PredefinedMenuItem::quit) so it goes
        // through the window close request and the unsaved-changes prompt.
        let app_menu = Submenu::with_items(
            app,
            "Aster",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("About Aster"), None)?,
                &sep()?,
                &item("settings", "Settings…", Some("Cmd+,"))?,
                &sep()?,
                &PredefinedMenuItem::services(app, None)?,
                &sep()?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &sep()?,
                &item("quit", "Quit Aster", Some("Cmd+Q"))?,
            ],
        )?;
        return Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window]);
    }

    #[cfg(not(target_os = "macos"))]
    Menu::with_items(app, &[&file, &edit, &view, &window])
}

pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("aster://menu", id);
}
