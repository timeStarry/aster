use std::process::Command;
use std::fs;
use tempfile::TempDir;

fn aster() -> Command {
    Command::new(env!("CARGO_BIN_EXE_aster"))
}

#[test]
fn test_read_outputs_json() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.md");
    fs::write(&path, "# Hello\n").unwrap();
    let out = aster()
        .args(["read", path.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(json["content"], "# Hello\n");
    assert_eq!(json["hash"].as_str().unwrap().len(), 64);
}

#[test]
fn test_outline_outputs_headings() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("h.md");
    fs::write(&path, "# A\n## B\n### C\n").unwrap();
    let out = aster()
        .args(["outline", path.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(out.status.success());
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(json[0]["level"], 1);
    assert_eq!(json[1]["level"], 2);
    assert_eq!(json[2]["level"], 3);
}

#[test]
fn test_run_unknown_command_exits_nonzero() {
    let out = aster()
        .args(["run", "nonexistent.cmd", "--json", "{}"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("E_NOT_FOUND"), "stderr: {stderr}");
}

#[test]
fn test_workspace_list() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("a.md"), "").unwrap();
    fs::write(dir.path().join("b.txt"), "").unwrap();
    let out = aster()
        .args(["workspace", "list", "--root", dir.path().to_str().unwrap()])
        .output()
        .unwrap();
    assert!(out.status.success());
    let out_str = String::from_utf8_lossy(&out.stdout);
    assert!(out_str.contains("a.md"));
    assert!(!out_str.contains("b.txt"));
}
