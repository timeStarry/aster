use aster_core::workspace::WorkspaceService;
use tempfile::TempDir;
use std::fs;

#[test]
fn test_workspace_list_md_only() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("a.md"), "").unwrap();
    fs::write(dir.path().join("b.txt"), "").unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub/c.md"), "").unwrap();

    let svc = WorkspaceService::new();
    svc.open(dir.path()).unwrap();
    let files = svc.list().unwrap();
    let names: Vec<_> = files.iter()
        .map(|p| p.file_name().unwrap().to_str().unwrap())
        .collect();
    assert!(names.contains(&"a.md"));
    assert!(names.contains(&"c.md"));
    assert!(!names.contains(&"b.txt"));
}

#[test]
fn test_workspace_open_nonexistent_errors() {
    let svc = WorkspaceService::new();
    let err = svc.open(std::path::Path::new("/nonexistent/path/xyz")).unwrap_err();
    assert_eq!(err.code(), "E_NOT_FOUND");
}

#[test]
fn test_workspace_list_without_open_errors() {
    let svc = WorkspaceService::new();
    let err = svc.list().unwrap_err();
    assert_eq!(err.code(), "E_NOT_FOUND");
}
