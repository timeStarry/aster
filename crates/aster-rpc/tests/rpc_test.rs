use aster_core::{
    commands::register_core_commands, document::DocumentService, plugin::PluginHost,
    registry::CommandRegistry, workspace::WorkspaceService,
};
use aster_rpc::{RpcClient, RpcServer};
use serde_json::json;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::Mutex as TokioMutex;

fn make_registry() -> Arc<TokioMutex<CommandRegistry>> {
    let mut reg = CommandRegistry::new();
    let doc = Arc::new(DocumentService::new());
    let ws = Arc::new(WorkspaceService::new());
    let host = Arc::new(Mutex::new(PluginHost::new().expect("wasmtime init")));
    register_core_commands(&mut reg, doc, ws, host);
    Arc::new(TokioMutex::new(reg))
}

fn sock_path(dir: &TempDir) -> PathBuf {
    #[cfg(unix)]
    {
        dir.path().join("test.sock")
    }
    #[cfg(windows)]
    {
        PathBuf::from(format!(
            r"\\.\pipe\aster-rpc-test-{}-{}",
            std::process::id(),
            dir.path().file_name().unwrap().to_string_lossy()
        ))
    }
}

async fn within<T>(future: impl Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(5), future)
        .await
        .expect("RPC operation should finish within five seconds")
}

#[tokio::test]
async fn test_rpc_doc_read() {
    let dir = TempDir::new().unwrap();
    let md = dir.path().join("hello.md");
    std::fs::write(&md, "# Hello\n").unwrap();

    let sock = sock_path(&dir);
    let reg = make_registry();
    let server = RpcServer::start(&sock, reg).await.unwrap();

    let mut client = within(RpcClient::connect(&sock))
        .await
        .expect("should connect");
    let result = within(client.call("doc.read", json!({"path": md.to_str().unwrap()})))
        .await
        .unwrap();
    assert_eq!(result["content"], "# Hello\n");
    assert!(result["hash"].as_str().unwrap().len() == 64);

    within(server.stop()).await;
}

#[tokio::test]
async fn test_rpc_unknown_method() {
    let dir = TempDir::new().unwrap();
    let sock = sock_path(&dir);
    let reg = make_registry();
    let server = RpcServer::start(&sock, reg).await.unwrap();

    let mut client = within(RpcClient::connect(&sock))
        .await
        .expect("should connect");
    let err = within(client.call("no.such.command", json!({})))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "E_NOT_FOUND");

    // An application error must not close a healthy transport.
    let err = within(client.call("no.such.command.again", json!({})))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "E_NOT_FOUND");
    within(server.stop()).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_rpc_concurrent_requests() {
    let dir = TempDir::new().unwrap();
    let md = dir.path().join("c.md");
    std::fs::write(&md, "concurrent\n").unwrap();

    let sock = sock_path(&dir);
    let reg = make_registry();
    let server = RpcServer::start(&sock, reg).await.unwrap();

    // 10 concurrent clients each call doc.read
    let mut handles = Vec::new();
    let barrier = Arc::new(tokio::sync::Barrier::new(10));
    for _ in 0..10 {
        let sock2 = sock.clone();
        let md2 = md.clone();
        let barrier = Arc::clone(&barrier);
        handles.push(tokio::spawn(async move {
            barrier.wait().await;
            let mut c = within(RpcClient::connect(&sock2)).await.expect("connect");
            for _ in 0..3 {
                let result = within(c.call("doc.read", json!({"path": md2.to_str().unwrap()})))
                    .await
                    .unwrap();
                assert_eq!(result["content"], "concurrent\n");
            }
        }));
    }
    for h in handles {
        within(h).await.unwrap();
    }

    within(server.stop()).await;
}

#[tokio::test]
async fn test_rpc_stop_closes_clients_and_allows_restart() {
    let dir = TempDir::new().unwrap();
    let sock = sock_path(&dir);
    let server = RpcServer::start(&sock, make_registry()).await.unwrap();
    let mut client = within(RpcClient::connect(&sock)).await.expect("connect");
    let err = within(client.call("no.such.command", json!({})))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "E_NOT_FOUND");

    within(server.stop()).await;
    let err = within(client.call("no.such.command", json!({})))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "E_IO");
    assert!(within(RpcClient::connect(&sock)).await.is_none());

    let server = RpcServer::start(&sock, make_registry())
        .await
        .expect("restart");
    let mut client = within(RpcClient::connect(&sock)).await.expect("reconnect");
    let err = within(client.call("no.such.command", json!({})))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "E_NOT_FOUND");
    within(server.stop()).await;
}

#[tokio::test]
async fn test_rpc_missing_endpoint_returns_none() {
    let dir = TempDir::new().unwrap();
    assert!(within(RpcClient::connect(&sock_path(&dir))).await.is_none());
}
