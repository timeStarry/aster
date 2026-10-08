use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use aster_core::registry::CommandRegistry;
use aster_rpc::RpcServer;

/// Platform-specific socket path for the running GUI instance.
pub fn socket_path() -> PathBuf {
    #[cfg(unix)]
    {
        if let Some(runtime_dir) = dirs::runtime_dir() {
            return runtime_dir.join("aster.sock");
        }
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".aster/run/aster.sock")
    }
    #[cfg(windows)]
    {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        PathBuf::from(format!(r"\\.\pipe\aster-{user}"))
    }
}

/// Start the JSON-RPC server in the background.
/// Returns a handle that must be kept alive for the duration of the app.
pub async fn start_rpc_server(registry: Arc<Mutex<CommandRegistry>>) -> Option<RpcServer> {
    let path = socket_path();
    // Ensure parent dir exists
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match RpcServer::start(&path, registry).await {
        Ok(server) => {
            eprintln!("[aster-rpc] listening on {}", path.display());
            Some(server)
        }
        Err(e) => {
            eprintln!("[aster-rpc] failed to start: {e}");
            None
        }
    }
}
