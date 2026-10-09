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
    /// Start a JSON-RPC 2.0 server on the given Unix socket / Windows named pipe.
    pub async fn start(
        path: &Path,
        registry: Arc<Mutex<CommandRegistry>>,
    ) -> std::io::Result<Self> {
        let path_buf = path.to_path_buf();

        #[cfg(unix)]
        let task = {
            use tokio::net::UnixListener;
            // Remove stale socket file
            let _ = tokio::fs::remove_file(&path_buf).await;
            let listener = UnixListener::bind(&path_buf)?;
            // Restrict to owner only — before anyone else can connect
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path_buf, std::fs::Permissions::from_mode(0o600))?;
            tokio::spawn(unix_accept_loop(listener, registry))
        };

        #[cfg(windows)]
        let task = {
            use tokio::net::windows::named_pipe::ServerOptions;
            let pipe = ServerOptions::new()
                .first_pipe_instance(true)
                .create(&path_buf)?;
            tokio::spawn(windows_accept_loop(pipe, registry))
        };

        #[cfg(not(any(unix, windows)))]
        let task = tokio::spawn(async {});

        Ok(Self { path: path_buf, task })
    }

    /// Stop the server and clean up the socket file.
    pub async fn stop(self) {
        self.task.abort();
        let _ = tokio::fs::remove_file(&self.path).await;
    }
}

// ── Unix implementation ──────────────────────────────────────────────────────

#[cfg(unix)]
async fn unix_accept_loop(
    listener: tokio::net::UnixListener,
    registry: Arc<Mutex<CommandRegistry>>,
) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let reg = Arc::clone(&registry);
                tokio::spawn(unix_handle_conn(stream, reg));
            }
            Err(_) => break,
        }
    }
}

#[cfg(unix)]
async fn unix_handle_conn(
    stream: tokio::net::UnixStream,
    registry: Arc<Mutex<CommandRegistry>>,
) {
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

// ── Windows implementation ───────────────────────────────────────────────────

#[cfg(windows)]
async fn windows_accept_loop(
    first_pipe: tokio::net::windows::named_pipe::NamedPipeServer,
    registry: Arc<Mutex<CommandRegistry>>,
) {
    use tokio::net::windows::named_pipe::ServerOptions;
    let path = {
        // We can't easily get the pipe path back from the handle, so we re-derive it.
        // This is fine because socket_path() is deterministic.
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        format!(r"\\.\pipe\aster-{user}")
    };

    let mut current = first_pipe;
    loop {
        if current.connect().await.is_err() {
            break;
        }
        // Prepare next instance before spawning handler so we don't miss connections
        let next = match ServerOptions::new().create(&path) {
            Ok(p) => p,
            Err(_) => break,
        };
        let reg = Arc::clone(&registry);
        tokio::spawn(windows_handle_conn(current, reg));
        current = next;
    }
}

#[cfg(windows)]
async fn windows_handle_conn(
    pipe: tokio::net::windows::named_pipe::NamedPipeServer,
    registry: Arc<Mutex<CommandRegistry>>,
) {
    let (read_half, mut write_half) = tokio::io::split(pipe);
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

// ── Shared JSON-RPC dispatch ─────────────────────────────────────────────────

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
