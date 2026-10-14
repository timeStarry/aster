//! Native window materials for the shared web editor.
//!
//! Platform effects are best-effort: the IPC result describes the effect that
//! actually succeeded, so the frontend can supply an opaque fallback surface.

use serde::Serialize;
use tauri::{Theme, WebviewWindow};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)] // Each native platform constructs only its supported materials.
pub enum Material {
    LiquidGlass,
    Vibrancy,
    Mica,
    Acrylic,
    Solid,
}

#[derive(Debug, Serialize)]
pub struct ShellAppearance {
    platform: &'static str,
    material: Material,
}

fn parse_theme(theme: Option<&str>) -> Result<Option<Theme>, String> {
    match theme {
        None | Some("system") => Ok(None),
        Some("light") => Ok(Some(Theme::Light)),
        Some("dark") => Ok(Some(Theme::Dark)),
        Some(_) => Err("Shell theme must be light, dark, or system".into()),
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn select_material(
    candidates: &[Material],
    mut apply: impl FnMut(Material) -> Result<(), String>,
) -> Material {
    for &material in candidates {
        match apply(material) {
            Ok(()) => return material,
            Err(error) => eprintln!("[aster-shell] {material:?} unavailable: {error}"),
        }
    }
    Material::Solid
}

fn appearance(material: Material) -> ShellAppearance {
    ShellAppearance {
        platform: if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(target_os = "windows") {
            "windows"
        } else {
            "linux"
        },
        material,
    }
}

fn configure_on_main_thread(
    window: WebviewWindow,
    theme: Option<Theme>,
    complete: impl FnOnce(Result<ShellAppearance, String>) + Send + 'static,
) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let native_window = window.clone();
        window.with_webview(move |webview| {
            let result = native_window
                .set_theme(theme)
                .map_err(|error| error.to_string());
            complete(result.map(|()| appearance(macos::apply(&native_window, webview))));
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let native_window = window.clone();
        window.run_on_main_thread(move || {
            let result = native_window
                .set_theme(theme)
                .map_err(|error| error.to_string());
            complete(result.map(|()| {
                #[cfg(target_os = "windows")]
                let material = windows::apply(&native_window);
                #[cfg(not(target_os = "windows"))]
                let material = Material::Solid;
                appearance(material)
            }));
        })
    }
}

/// Apply the platform material before displaying the first frame.
pub fn initialize(window: WebviewWindow) -> tauri::Result<()> {
    let visible_window = window.clone();
    configure_on_main_thread(window, None, move |result| {
        if let Err(error) = result {
            eprintln!("[aster-shell] native appearance initialization failed: {error}");
        }
        if let Err(error) = visible_window.show() {
            eprintln!("[aster-shell] failed to show main window: {error}");
        }
    })
}

/// `None` / `system` follow the OS; plugin themes pass their resolved light/dark.
#[tauri::command]
pub async fn configure_shell(
    window: WebviewWindow,
    theme: Option<String>,
) -> Result<ShellAppearance, String> {
    if window.label() != "main" {
        return Err("Native shell appearance is only available for the main window".into());
    }
    let theme = parse_theme(theme.as_deref())?;
    let (send, receive) = tokio::sync::oneshot::channel();
    configure_on_main_thread(window, theme, move |result| {
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_reports_the_first_effect_that_succeeded() {
        let mut attempted = Vec::new();
        let material = select_material(&[Material::Mica, Material::Acrylic], |candidate| {
            attempted.push(candidate);
            if candidate == Material::Acrylic {
                Ok(())
            } else {
                Err("unsupported".into())
            }
        });
        assert_eq!(attempted, vec![Material::Mica, Material::Acrylic]);
        assert_eq!(material, Material::Acrylic);

        let material = select_material(&[Material::LiquidGlass, Material::Vibrancy], |_| {
            Err("unsupported".into())
        });
        assert_eq!(material, Material::Solid);
    }

    #[test]
    fn successful_effect_does_not_attempt_fallbacks() {
        let mut attempted = Vec::new();
        let material = select_material(&[Material::LiquidGlass, Material::Vibrancy], |candidate| {
            attempted.push(candidate);
            Ok(())
        });
        assert_eq!(attempted, vec![Material::LiquidGlass]);
        assert_eq!(material, Material::LiquidGlass);
    }

    #[test]
    fn ipc_theme_contract_accepts_system_and_rejects_unknown_themes() {
        assert_eq!(parse_theme(None), Ok(None));
        assert_eq!(parse_theme(Some("system")), Ok(None));
        assert_eq!(parse_theme(Some("light")), Ok(Some(Theme::Light)));
        assert_eq!(parse_theme(Some("dark")), Ok(Some(Theme::Dark)));
        assert!(parse_theme(Some("custom-plugin-theme")).is_err());
    }

    #[test]
    fn ipc_material_names_match_the_frontend_contract() {
        let result = serde_json::to_value(ShellAppearance {
            platform: "macos",
            material: Material::LiquidGlass,
        })
        .unwrap();
        assert_eq!(
            result,
            serde_json::json!({ "platform": "macos", "material": "liquid-glass" })
        );
    }
}
