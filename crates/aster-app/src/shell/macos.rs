use super::{select_material, Material};
use objc2::{rc::Retained, runtime::AnyClass, MainThreadMarker};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSGlassEffectViewStyle, NSView, NSWindow,
    NSWindowOrderingMode, NSWorkspace,
};
use tauri::{webview::PlatformWebview, Theme, WebviewWindow};
use window_vibrancy::NSGlassEffectViewTagged;

// Our tag is distinct from window-vibrancy's effects. The parent retains glass,
// and glass retains its contentView; no native pointer outlives the window.
const GLASS_TAG: isize = 0x41535452;
const VIBRANCY_TAG: isize = 91376254;

pub(super) fn apply(window: &WebviewWindow, webview: PlatformWebview) -> Material {
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[aster-shell] macOS effects require the main thread");
        return Material::Solid;
    };
    let Ok(container_ptr) = window.ns_view() else {
        return Material::Solid;
    };
    // SAFETY: Tauri provides these live NSView / WKWebView handles only on its
    // main-thread with_webview callback. Retain WKWebView across reparenting.
    let Some(container) = (unsafe { container_ptr.cast::<NSView>().as_ref() }) else {
        return Material::Solid;
    };
    let Some(content) = (unsafe { Retained::retain(webview.inner().cast::<NSView>()) }) else {
        return Material::Solid;
    };
    let Some(native_window) = (unsafe { webview.ns_window().cast::<NSWindow>().as_ref() }) else {
        return Material::Solid;
    };

    if NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency() {
        remove_glass(container);
        let _ = window_vibrancy::clear_vibrancy(window);
        let dark = window.theme().unwrap_or(Theme::Light) == Theme::Dark;
        let (r, g, b) = if dark {
            (28.0, 28.0, 30.0)
        } else {
            (245.0, 245.0, 247.0)
        };
        let color =
            NSColor::colorWithSRGBRed_green_blue_alpha(r / 255.0, g / 255.0, b / 255.0, 1.0);
        native_window.setBackgroundColor(Some(&color));
        native_window.setOpaque(true);
        return Material::Solid;
    }
    // with_webview may hold Wry's dispatcher lock during setup. Use AppKit
    // directly: WebviewWindow::set_background_color would re-enter the same
    // Webview dispatcher and deadlock. WKWebView is transparent at creation.
    native_window.setBackgroundColor(Some(&NSColor::clearColor()));
    native_window.setOpaque(false);

    // Appearance updates only change NSApp's theme; do not detach the editor or
    // stack effect views when a user switches between light, dark and system.
    if container.viewWithTag(GLASS_TAG).is_some() {
        return Material::LiquidGlass;
    }
    if container.viewWithTag(VIBRANCY_TAG).is_some() {
        return Material::Vibrancy;
    }

    let material = select_material(&[Material::LiquidGlass, Material::Vibrancy], |candidate| {
        match candidate {
            Material::LiquidGlass => {
                // Looking up the class first avoids touching a superclass that
                // does not exist on pre-Tahoe versions of AppKit.
                if AnyClass::get(c"NSGlassEffectView").is_none() {
                    return Err("NSGlassEffectView requires macOS 26 or newer".into());
                }
                let bounds = container.bounds();
                // SAFETY: class availability and main-thread affinity checked above.
                let glass = unsafe {
                    NSGlassEffectViewTagged::initWithFrame(mtm.alloc(), bounds, GLASS_TAG)
                };
                glass.setStyle(NSGlassEffectViewStyle::Regular);
                glass.setCornerRadius(0.0);
                let resize = NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable;
                glass.setAutoresizingMask(resize);
                content.removeFromSuperview();
                content.setFrame(bounds);
                content.setAutoresizingMask(resize);
                // AppKit guarantees glass z-order only for contentView. Adding
                // a sibling WKWebView above a glass background is insufficient.
                glass.setContentView(Some(&content));
                container.addSubview_positioned_relativeTo(
                    &glass,
                    NSWindowOrderingMode::Below,
                    None,
                );
                Ok(())
            }
            Material::Vibrancy => window_vibrancy::apply_vibrancy(
                window,
                window_vibrancy::NSVisualEffectMaterial::Sidebar,
                Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
                None,
            )
            .map_err(|error| error.to_string()),
            _ => unreachable!(),
        }
    });
    material
}

fn remove_glass(container: &NSView) {
    let Some(glass) = container
        .viewWithTag(GLASS_TAG)
        .and_then(|view| view.downcast::<NSGlassEffectViewTagged>().ok())
    else {
        return;
    };
    // Keep a strong reference while setContentView releases glass's ownership.
    // Restore the original parent before removing the effect view, so Wry's
    // editor handle, first responder and resize behavior remain valid.
    if let Some(content) = glass.contentView() {
        glass.setContentView(None);
        container.addSubview(&content);
        content.setFrame(container.bounds());
        content.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
    }
    glass.removeFromSuperview();
}
