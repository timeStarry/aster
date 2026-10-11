use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// Menu language. The frontend owns the language setting and calls
/// `set_menu_language` on startup and whenever it changes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    En,
    Zh,
}

impl Lang {
    pub fn parse(tag: &str) -> Self {
        if tag.to_ascii_lowercase().starts_with("zh") { Lang::Zh } else { Lang::En }
    }
}

/// (English, Chinese) label for a menu entry.
fn label(lang: Lang, key: &str) -> &'static str {
    let (en, zh) = match key {
        "file" => ("File", "文件"),
        "edit" => ("Edit", "编辑"),
        "view" => ("View", "显示"),
        "window" => ("Window", "窗口"),
        "new" => ("New Tab", "新建标签页"),
        "open" => ("Open…", "打开…"),
        "save" => ("Save", "保存"),
        "saveAs" => ("Save As…", "另存为…"),
        "exportPdf" => ("Export as PDF…", "导出为 PDF…"),
        "close" => ("Close Tab", "关闭标签页"),
        "settings" => ("Settings…", "设置…"),
        "quit" => ("Quit", "退出"),
        "quitAster" => ("Quit Aster", "退出 Aster"),
        "about" => ("About Aster", "关于 Aster"),
        "undo" => ("Undo", "撤销"),
        "redo" => ("Redo", "重做"),
        "cut" => ("Cut", "剪切"),
        "copy" => ("Copy", "拷贝"),
        "paste" => ("Paste", "粘贴"),
        "selectAll" => ("Select All", "全选"),
        "find" => ("Find…", "查找…"),
        "modeLive" => ("Live Preview", "实时预览"),
        "modeSource" => ("Source", "源码"),
        "toggleMode" => ("Toggle Live / Source", "切换实时 / 源码"),
        "toggleLock" => ("Toggle Read-only", "切换只读"),
        "nextTab" => ("Next Tab", "下一个标签页"),
        "prevTab" => ("Previous Tab", "上一个标签页"),
        "minimize" => ("Minimize", "最小化"),
        "zoom" => ("Zoom", "缩放"),
        "fullscreen" => ("Enter Full Screen", "进入全屏幕"),
        "services" => ("Services", "服务"),
        "hide" => ("Hide Aster", "隐藏 Aster"),
        "hideOthers" => ("Hide Others", "隐藏其他"),
        "showAll" => ("Show All", "全部显示"),
        _ => ("?", "?"),
    };
    if lang == Lang::Zh { zh } else { en }
}

/// Native menu. Every custom item emits `aster://menu` with its id; the
/// frontend owns the behavior so menu and keyboard shortcuts share one path.
///
/// Formatting commands are deliberately not given menu accelerators: the
/// editor keymap already handles them, and a menu accelerator firing as well
/// would apply toggles (e.g. bold) twice.
pub fn build<R: Runtime>(app: &AppHandle<R>, lang: Lang) -> tauri::Result<Menu<R>> {
    let l = |k: &str| label(lang, k);
    let item = |id: &str, accel: Option<&str>| MenuItem::with_id(app, id, l(id), true, accel);
    let sep = || PredefinedMenuItem::separator(app);

    let file = Submenu::with_items(
        app,
        l("file"),
        true,
        &[
            &item("new", Some("CmdOrCtrl+N"))?,
            &item("open", Some("CmdOrCtrl+O"))?,
            &sep()?,
            &item("save", Some("CmdOrCtrl+S"))?,
            &item("saveAs", Some("CmdOrCtrl+Shift+S"))?,
            &item("exportPdf", None)?,
            &sep()?,
            &item("close", Some("CmdOrCtrl+W"))?,
            #[cfg(not(target_os = "macos"))]
            &sep()?,
            #[cfg(not(target_os = "macos"))]
            &item("settings", Some("CmdOrCtrl+,"))?,
            #[cfg(not(target_os = "macos"))]
            &item("quit", Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    // Predefined clipboard items are required on macOS for ⌘C/⌘V to reach the
    // webview. Undo/redo arrive in CodeMirror as historyUndo/historyRedo input
    // events, which its history extension handles.
    let edit = Submenu::with_items(
        app,
        l("edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(l("undo")))?,
            &PredefinedMenuItem::redo(app, Some(l("redo")))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some(l("cut")))?,
            &PredefinedMenuItem::copy(app, Some(l("copy")))?,
            &PredefinedMenuItem::paste(app, Some(l("paste")))?,
            &PredefinedMenuItem::select_all(app, Some(l("selectAll")))?,
            &sep()?,
            &item("find", Some("CmdOrCtrl+F"))?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        l("view"),
        true,
        &[
            &item("modeLive", None)?,
            &item("modeSource", None)?,
            &item("toggleMode", Some("CmdOrCtrl+/"))?,
            &sep()?,
            &item("toggleLock", Some("CmdOrCtrl+Alt+L"))?,
            &sep()?,
            &item("nextTab", Some("Ctrl+Tab"))?,
            &item("prevTab", Some("Ctrl+Shift+Tab"))?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        l("window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(l("minimize")))?,
            &PredefinedMenuItem::maximize(app, Some(l("zoom")))?,
            &PredefinedMenuItem::fullscreen(app, Some(l("fullscreen")))?,
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
                &PredefinedMenuItem::about(app, Some(l("about")), Some(AboutMetadata::default()))?,
                &sep()?,
                &MenuItem::with_id(app, "settings", l("settings"), true, Some("Cmd+,"))?,
                &sep()?,
                &PredefinedMenuItem::services(app, Some(l("services")))?,
                &sep()?,
                &PredefinedMenuItem::hide(app, Some(l("hide")))?,
                &PredefinedMenuItem::hide_others(app, Some(l("hideOthers")))?,
                &PredefinedMenuItem::show_all(app, Some(l("showAll")))?,
                &sep()?,
                &MenuItem::with_id(app, "quit", l("quitAster"), true, Some("Cmd+Q"))?,
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

/// Rebuild the native menu and restore its Windows visibility in one command.
/// Hidden menus retain their accelerators; macOS and Linux keep native behavior.
#[tauri::command]
pub fn set_menu_language(app: AppHandle, lang: String, visible: Option<bool>) -> Result<(), String> {
    let menu = build(&app, Lang::parse(&lang)).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    if visible.unwrap_or(false) {
        app.show_menu().map_err(|e| e.to_string())?;
    } else {
        app.hide_menu().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = visible;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_language_tags() {
        assert_eq!(Lang::parse("zh"), Lang::Zh);
        assert_eq!(Lang::parse("zh-CN"), Lang::Zh);
        assert_eq!(Lang::parse("ZH-hans"), Lang::Zh);
        assert_eq!(Lang::parse("en"), Lang::En);
        assert_eq!(Lang::parse("fr"), Lang::En);
    }

    #[test]
    fn every_label_is_translated() {
        let keys = [
            "file", "edit", "view", "window", "new", "open", "save", "saveAs", "exportPdf",
            "close", "settings", "quit", "quitAster", "about", "undo", "redo", "cut", "copy",
            "paste", "selectAll", "find", "modeLive", "modeSource", "toggleMode", "toggleLock",
            "nextTab", "prevTab", "minimize", "zoom", "fullscreen", "services", "hide",
            "hideOthers", "showAll",
        ];
        for k in keys {
            assert_ne!(label(Lang::En, k), "?", "missing en label for {k}");
            assert_ne!(label(Lang::Zh, k), "?", "missing zh label for {k}");
        }
    }
}
