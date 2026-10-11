fn main() {
    // Recompile the Windows PE resources when only the application icon changes.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        // Tauri's static CRT shim puts a replacement msvcrt.lib in OUT_DIR.
        // Cargo shares native search paths with workspace doctests, which do
        // not inherit Tauri's CRT linker overrides. Use the normal debug CRT
        // so those tests can resolve the real runtime; release keeps its
        // configured static runtime for distributed Windows binaries.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new().static_vc_runtime(false));
    }
    tauri_build::try_build(attributes).expect("failed to build Tauri application");
}
