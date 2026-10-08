use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use tempfile::TempDir;
use tokio::sync::Mutex as TokioMutex;
use serde_json::json;
use aster_core::{
    document::DocumentService,
    workspace::WorkspaceService,
    plugin::PluginHost,
    registry::CommandRegistry,
    commands::register_core_commands,
};
use aster_rpc::{RpcServer, RpcClient};

fn make_registry() -> Arc<TokioMutex<CommandRegistry>> {
    let mut reg = CommandRegistry::new();
    let doc = Arc::new(DocumentService::new());
    let ws = Arc::new(WorkspaceService::new());
    let host = Arc::new(Mutex::new(PluginHost::new()));
    register_core_commands(&mut reg, doc, ws, host);
    Arc::new(TokioMutex::new(reg))
}

fn sock_path(dir: &TempDir) -> PathBuf {
    dir.path().join("test.sock")
}

#[tokio::test]
async fn test_rpc_doc_read() {
    let dir = TempDir::new().unwrap();
    let md = dir.path().join("hello.md");
    std::fs::write(&md, "# Hello\n").unwrap();

    let sock = sock_path(&dir);
    let reg = make_registry();
    let server = RpcServer::start(&sock, reg).await.unwrap();

    let mut client = RpcClient::connect(&sock).await.expect("should connect");
    let result = client.call("doc.read", json!({"path": md.to_str().unwrap()})).await.unwrap();
    assert_eq!(result["content"], "# Hello\n");
    assert!(result["hash"].as_str().unwrap().len() == 64);

    server.stop().await;
}

#[tokio::test]
async fn test_rpc_unknown_method() {
    let dir = TempDir::new().unwrap();
    let sock = sock_path(&dir);
    let reg = make_registry();
    let server = RpcServer::start(&sock, reg).await.unwrap();

    let mut client = RpcClient::connect(&sock).await.expect("should connect");
    let err = client.call("no.such.command", json!({})).await.unwrap_err();
    assert_eq!(err.code(), "E_NOT_FOUND");

    server.stop().await;
}

#[tokio::test]
async fn test_rpc_concurrent_requests() {
    let dir = TempDir::new().unwrap();
    let md = dir.path().join("c.md");
    std::fs::write(&md, "concurrent\n").unwrap();

    let sock = sock_path(&dir);
    let reg = make_registry();
    let server = RpcServer::start(&sock, reg).await.unwrap();

    // 10 concurrent clients each call doc.read
    let mut handles = Vec::new();
    for _ in 0..10 {
        let sock2 = sock.clone();
        let md2 = md.clone();
        handles.push(tokio::spawn(async move {
            let mut c = RpcClient::connect(&sock2).await.expect("connect");
            c.call("doc.read", json!({"path": md2.to_str().unwrap()})).await.unwrap()
        }));
    }
    for h in handles {
        let result = h.await.unwrap();
        assert_eq!(result["content"], "concurrent\n");
    }

    server.stop().await;
}
