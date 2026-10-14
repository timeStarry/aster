use super::{select_material, Material};
use std::{ffi::c_void, mem::size_of};
use tauri::{window::Color, Theme, WebviewWindow};
use windows_sys::core::BOOL;
use windows_sys::Win32::{
    Foundation::HWND,
    System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
};

pub(super) fn apply<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Material {
    let dark = window.theme().unwrap_or(Theme::Light) == Theme::Dark;
    // Clear the old accent before trying Mica, especially after a theme change
    // on an Acrylic-only system. Mica's DWM API replaces its own backdrop.
    let _ = window_vibrancy::clear_acrylic(window);
    let material = select_material(
        &[Material::Mica, Material::Acrylic],
        |candidate| match candidate {
            Material::Mica => {
                window_vibrancy::apply_mica(window, Some(dark)).map_err(|error| error.to_string())
            }
            Material::Acrylic => apply_acrylic_checked(window, dark),
            _ => unreachable!(),
        },
    );
    let color = if material == Material::Solid {
        if dark {
            Color(32, 32, 32, 255)
        } else {
            Color(243, 243, 243, 255)
        }
    } else {
        Color(0, 0, 0, 0)
    };
    if let Err(error) = window.set_background_color(Some(color)) {
        eprintln!("[aster-shell] failed to set window backdrop color: {error}");
    }
    material
}

fn apply_acrylic_checked<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    dark: bool,
) -> Result<(), String> {
    let build = windows_version::OsVersion::current().build;
    // window-vibrancy checks HRESULT on the documented Windows 11 DWM path.
    if build >= 22523 {
        return window_vibrancy::apply_acrylic(window, None).map_err(|error| error.to_string());
    }
    if build < 17763 {
        return Err("Acrylic requires Windows 10 1809 or newer".into());
    }

    // The crate's legacy Acrylic path discards the API's BOOL result. Check it
    // here, so unavailable composition yields Solid instead of a false report.
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    unsafe {
        let user32: Vec<u16> = "user32.dll\0".encode_utf16().collect();
        let module = GetModuleHandleW(user32.as_ptr());
        if module.is_null() {
            return Err("user32.dll is unavailable".into());
        }
        let address = GetProcAddress(module, c"SetWindowCompositionAttribute".as_ptr().cast())
            .ok_or_else(|| "SetWindowCompositionAttribute is unavailable".to_string())?;
        type SetComposition = unsafe extern "system" fn(HWND, *mut CompositionData) -> BOOL;
        let set_composition: SetComposition = std::mem::transmute(address);
        let (r, g, b, a) = if dark {
            (32_u32, 32, 32, 210)
        } else {
            (243, 243, 243, 210)
        };
        let mut policy = AccentPolicy {
            state: 4, // ACCENT_ENABLE_ACRYLICBLURBEHIND
            flags: 0,
            gradient_color: r | (g << 8) | (b << 16) | (a << 24),
            animation_id: 0,
        };
        let mut data = CompositionData {
            attribute: 19, // WCA_ACCENT_POLICY
            data: (&mut policy as *mut AccentPolicy).cast(),
            size: size_of::<AccentPolicy>(),
        };
        if set_composition(hwnd, &mut data) == 0 {
            Err(format!(
                "SetWindowCompositionAttribute failed: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }
}

#[repr(C)]
struct AccentPolicy {
    state: u32,
    flags: u32,
    gradient_color: u32,
    animation_id: u32,
}

#[repr(C)]
struct CompositionData {
    attribute: u32,
    data: *mut c_void,
    size: usize,
}
