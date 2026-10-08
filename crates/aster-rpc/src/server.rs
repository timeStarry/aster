use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use serde_json::{json, Value};
use aster_core::registry::CommandRegistry;

pub struct RpcServer {
    path: PathBuf,
    task: tokio::task::JoinHandle<()>,
}

impl RpcServer {
    /// Start a JSON-RPC 2.0 server on the given Unix socket path.
    /// The socket file is created with 0600 permissions on Unix.
    pub async fn start(
        path: &Path,
        registry: Arc<Mutex<CommandRegistry>>,
    ) -> std::io::Result<Self> {
        // Remove stale socket
        let _ = tokio::fs::remove_file(path).await;

        let path_buf = path.to_path_buf();

        #[cfg(unix)]
        let listener = {
            use tokio::net::UnixListener;
            let listener = UnixListener::bind(&path_buf)?;
            // Restrict to owner only
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path_buf, std::fs::Permissions::from_mode(0o600))?;
            listener
        };

        #[cfg(windows)]
        let listener = {
            // Windows named pipe — best-effort, no ACL in M2
            use tokio::net::windows::named_pipe::ServerOptions;
            ServerOptions::new()
                .first_pipe_instance(true)
                .create(&path_buf)?
        };

        let task = tokio::spawn(accept_loop(listener, registry));

        Ok(Self { path: path_buf, task })
    }

    /// Stop the server and delete the socket file.
    pub async fn stop(self) {
        self.task.abort();
        let _ = tokio::fs::remove_file(&self.path).await;
    }
}

#[cfg(unix)]
async fn accept_loop(listener: tokio::net::UnixListener, registry: Arc<Mutex<CommandRegistry>>) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let reg = Arc::clone(&registry);
                tokio::spawn(handle_conn(stream, reg));
            }
            Err(_) => break,
        }
    }
}

#[cfg(unix)]
async fn handle_conn(stream: tokio::net::UnixStream, registry: Arc<Mutex<CommandRegistry>>) {
    let (read_half, mut write_half) = tokio::io::split(stream);
    let mut lines = BufReader::new(read_half).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let response = dispatch_line(&line, &registry).await;
        let mut out = serde_json::to_string(&response).unwrap_or_default();
        out.push('\n');
        if write_half.write_all(out.as_bytes()).await.is_err() {
            break;
        }
    }
}

async fn dispatch_line(line: &str, registry: &Arc<Mutex<CommandRegistry>>) -> Value {
    let req: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            return json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": format!("Parse error: {e}") }
            });
        }
    };

    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let method = match req.get("method").and_then(|v| v.as_str()) {
        Some(m) => m.to_owned(),
        None => {
            return json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32600, "message": "Invalid Request: missing method" }
            });
        }
    };
    let params = req.get("params").cloned().unwrap_or(json!({}));

    let mut reg = registry.lock().await;
    match reg.dispatch(&method, params) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(e) => {
            let rpc_code = if e.code() == "E_NOT_FOUND" { -32601i64 } else { -32000i64 };
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": rpc_code,
                    "message": e.to_string(),
                    "data": { "code": e.code(), "message": e.to_string() }
                }
            })
        }
    }
}
