use aster_core::wasm_host::{WasmHost, HostContext};

#[test]
fn test_wasm_host_new() {
    let host = WasmHost::new();
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

#[test]
fn test_host_context_no_permissions_denies_all() {
    let ctx = HostContext::new(vec![], None);
    let result = ctx.check_read_permission("/etc/passwd");
    assert!(result.is_err());
    let e = result.unwrap_err();
    assert_eq!(e.code(), "E_PERMISSION_DENIED");
}

#[test]
fn test_host_context_fs_workspace_allows_inside() {
    use std::path::PathBuf;
    let workspace = PathBuf::from("/home/user/notes");
    let ctx = HostContext::new(vec!["fs:workspace".into()], Some(workspace));
    assert!(ctx.check_read_permission("/home/user/notes/todo.md").is_ok());
    // path outside workspace is denied
    assert!(ctx.check_read_permission("/etc/passwd").is_err());
}

#[test]
fn test_host_context_fs_any_allows_all() {
    let ctx = HostContext::new(vec!["fs:any".into()], None);
    assert!(ctx.check_read_permission("/etc/passwd").is_ok());
    assert!(ctx.check_write_permission("/tmp/out.txt").is_ok());
}
