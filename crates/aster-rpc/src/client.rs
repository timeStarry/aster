use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use serde_json::{json, Value};
use aster_core::error::{AsterError, AsterResult};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_id() -> u64 {
    ID_COUNTER.fetch_add(1, Ordering::Relaxed)
}

pub struct RpcClient {
    #[cfg(unix)]
    write: tokio::net::unix::OwnedWriteHalf,
    #[cfg(unix)]
    reader: BufReader<tokio::net::unix::OwnedReadHalf>,
}

impl RpcClient {
    /// Try to connect to the socket. Returns `None` if the socket does not exist or refuses.
    pub async fn connect(path: &Path) -> Option<Self> {
        #[cfg(unix)]
        {
            let stream = tokio::net::UnixStream::connect(path).await.ok()?;
            let (read, write) = stream.into_split();
            Some(Self { write, reader: BufReader::new(read) })
        }
        #[cfg(not(unix))]
        {
            let _ = path;
            None
        }
    }

    /// Send a JSON-RPC 2.0 request and return the result or an AsterError.
    pub async fn call(&mut self, method: &str, params: Value) -> AsterResult<Value> {
        let id = next_id();
        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let mut line = serde_json::to_string(&req)
            .map_err(|e| AsterError::Io(e.to_string()))?;
        line.push('\n');

        #[cfg(unix)]
        {
            self.write.write_all(line.as_bytes()).await
                .map_err(|e| AsterError::Io(e.to_string()))?;

            let mut resp_line = String::new();
            self.reader.read_line(&mut resp_line).await
                .map_err(|e| AsterError::Io(e.to_string()))?;

            let resp: Value = serde_json::from_str(&resp_line)
                .map_err(|e| AsterError::Io(format!("bad RPC response: {e}")))?;

            if let Some(err) = resp.get("error") {
                let code = err.get("data")
                    .and_then(|d| d.get("code"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("E_IO");
                let msg = err.get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("RPC error")
                    .to_owned();
                return Err(match code {
                    "E_NEEDS_GUI" => AsterError::NeedsGui { hint: msg },
                    "E_NOT_FOUND" => AsterError::NotFound(msg),
                    "E_CONFLICT" => {
                        let data = err.get("data").unwrap_or(&Value::Null);
                        AsterError::Conflict {
                            expected: data.get("expected").and_then(|v| v.as_str()).unwrap_or("").to_owned(),
                            actual:   data.get("actual").and_then(|v| v.as_str()).unwrap_or("").to_owned(),
                        }
                    }
                    "E_ANCHOR_NOT_FOUND" => AsterError::AnchorNotFound(msg),
                    "E_INVALID_PARAMS" => AsterError::InvalidParams(msg),
                    _ => AsterError::Io(msg),
                });
            }

            resp.get("result")
                .cloned()
                .ok_or_else(|| AsterError::Io("RPC response missing 'result'".into()))
        }
        #[cfg(not(unix))]
        {
            Err(AsterError::Io("RPC client not supported on this platform".into()))
        }
    }
}
