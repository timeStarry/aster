use std::process::Command;
use std::fs;
use std::io::Write;
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

#[test]
fn test_patch_headless() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p.md");
    fs::write(&path, "# Title\n## TODO\nsome text\n").unwrap();
    let patch_json = serde_json::json!({
        "path": path.to_str().unwrap(),
        "edits": [{
            "type": "anchor",
            "anchor": { "find": "## TODO", "occurrence": 1, "position": "after" },
            "text": "- new item\n"
        }]
    }).to_string();
    let out = aster()
        .args(["run", "doc.patch", "--json", &patch_json])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let result: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(result["hash"].as_str().is_some(), "expected hash in result");
    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains("- new item\n"), "content: {content}");
}

#[test]
fn test_mcp_tools_list() {
    // Start `aster mcp`, send initialize + tools/list, expect tool names back
    let mut child = aster()
        .arg("mcp")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();

    let stdin = child.stdin.as_mut().unwrap();
    // MCP initialize
    let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}"#;
    writeln!(stdin, "{init}").unwrap();
    // tools/list
    let list = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#;
    writeln!(stdin, "{list}").unwrap();
    let _ = stdin; // close stdin so mcp exits

    let output = child.wait_with_output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("doc_read"), "tools/list must include doc_read; got: {stdout}");
    assert!(stdout.contains("doc_patch"), "tools/list must include doc_patch; got: {stdout}");
}
