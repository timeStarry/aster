use aster_core::wasm_host::WasmHost;

#[test]
fn test_wasm_host_new() {
    let host = WasmHost::new();
    // No components loaded, invoke returns E_NOT_FOUND
    let result = host.invoke("nonexistent.plugin", "some.cmd", "{}");
    assert!(result.is_err());
    let e = result.unwrap_err();
    assert_eq!(e.code(), "E_NOT_FOUND");
}

#[test]
fn test_wasm_host_transform_not_loaded() {
    let mut host = WasmHost::new();
    let result = host.transform("nonexistent.plugin", "onAfterRead", "/tmp/test.md", b"content".to_vec());
    assert!(result.is_err());
    let e = result.unwrap_err();
    assert_eq!(e.code(), "E_NOT_FOUND");
}
