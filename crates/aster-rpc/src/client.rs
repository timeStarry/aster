use aster_core::error::{AsterError, AsterResult};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[cfg(unix)]
type ClientStream = tokio::net::UnixStream;
#[cfg(windows)]
type ClientStream = tokio::net::windows::named_pipe::NamedPipeClient;

#[cfg(any(unix, windows))]
struct Connection {
    write: tokio::io::WriteHalf<ClientStream>,
    reader: BufReader<tokio::io::ReadHalf<ClientStream>>,
}

pub struct RpcClient {
    #[cfg(any(unix, windows))]
    connection: Option<Connection>,
}

impl RpcClient {
    /// Connect to the Unix socket or Windows named pipe. Busy pipe instances are
    /// retried for up to two seconds; missing or refused endpoints return None.
    pub async fn connect(path: &Path) -> Option<Self> {
        #[cfg(unix)]
        let stream = tokio::net::UnixStream::connect(path).await.ok()?;

        #[cfg(windows)]
        let stream = {
            use tokio::net::windows::named_pipe::ClientOptions;
            // ERROR_PIPE_BUSY: the server is preparing its next pipe instance.
            const ERROR_PIPE_BUSY: i32 = 231;
            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    match ClientOptions::new().open(path) {
                        Ok(stream) => return Some(stream),
                        Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                            tokio::time::sleep(Duration::from_millis(10)).await;
                        }
                        Err(_) => return None,
                    }
                }
            })
            .await
            .ok()??
        };

        #[cfg(any(unix, windows))]
        {
            let (read, write) = tokio::io::split(stream);
            Some(Self {
                connection: Some(Connection {
                    write,
                    reader: BufReader::new(read),
                }),
            })
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = path;
            None
        }
    }

    /// Send a JSON-RPC 2.0 request and return its result or an AsterError.
    /// A transport failure or a 30-second timeout closes the connection so a
    /// late response cannot be mistaken for the result of a later request.
    pub async fn call(&mut self, method: &str, params: Value) -> AsterResult<Value> {
        self.call_with_timeout(method, params, REQUEST_TIMEOUT)
            .await
    }

    async fn call_with_timeout(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> AsterResult<Value> {
        #[cfg(any(unix, windows))]
        {
            let connection = self
                .connection
                .as_mut()
                .ok_or_else(|| AsterError::Io("RPC connection is closed".into()))?;
            let id = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
            let response =
                match tokio::time::timeout(timeout, connection.request(id, method, params)).await {
                    Ok(Ok(response)) => response,
                    Ok(Err(error)) => {
                        self.connection = None;
                        return Err(error);
                    }
                    Err(_) => {
                        self.connection = None;
                        return Err(AsterError::Io("RPC request timed out".into()));
                    }
                };

            if let Some(err) = response.get("error") {
                let code = err
                    .get("data")
                    .and_then(|d| d.get("code"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("E_IO");
                let msg = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("RPC error")
                    .to_owned();
                return Err(match code {
                    "E_NEEDS_GUI" => AsterError::NeedsGui { hint: msg },
                    "E_NOT_FOUND" => AsterError::NotFound(msg),
                    "E_CONFLICT" => {
                        let data = err.get("data").unwrap_or(&Value::Null);
                        AsterError::Conflict {
                            expected: data
                                .get("expected")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_owned(),
                            actual: data
                                .get("actual")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_owned(),
                        }
                    }
                    "E_ANCHOR_NOT_FOUND" => AsterError::AnchorNotFound(msg),
                    "E_INVALID_PARAMS" => AsterError::InvalidParams(msg),
                    _ => AsterError::Io(msg),
                });
            }

            response
                .get("result")
                .cloned()
                .ok_or_else(|| AsterError::Io("RPC response missing 'result'".into()))
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = (method, params, timeout);
            Err(AsterError::Io(
                "RPC client not supported on this platform".into(),
            ))
        }
    }
}

#[cfg(any(unix, windows))]
impl Connection {
    async fn request(&mut self, id: u64, method: &str, params: Value) -> AsterResult<Value> {
        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let mut line = serde_json::to_string(&req).map_err(|e| AsterError::Io(e.to_string()))?;
        line.push('\n');
        self.write.write_all(line.as_bytes()).await?;

        let mut response_line = String::new();
        if self.reader.read_line(&mut response_line).await? == 0 {
            return Err(AsterError::Io("RPC server closed the connection".into()));
        }
        let response: Value = serde_json::from_str(&response_line)
            .map_err(|e| AsterError::Io(format!("bad RPC response: {e}")))?;
        if response.get("id").and_then(Value::as_u64) != Some(id) {
            return Err(AsterError::Io("RPC response has an unexpected id".into()));
        }
        Ok(response)
    }
}

#[cfg(all(test, any(unix, windows)))]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[tokio::test]
    async fn busy_pipe_retries_and_has_a_deadline() {
        use tokio::net::windows::named_pipe::{ClientOptions, ServerOptions};
        let dir = tempfile::TempDir::new().unwrap();
        let path = std::path::PathBuf::from(format!(
            r"\\.\pipe\aster-rpc-busy-{}-{}",
            std::process::id(),
            dir.path().file_name().unwrap().to_string_lossy()
        ));
        let first = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&path)
            .unwrap();
        let _first_client = ClientOptions::new().open(&path).unwrap();
        first.connect().await.unwrap();

        let next_path = path.clone();
        let next = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(40)).await;
            ServerOptions::new().create(next_path).unwrap()
        });
        let client = tokio::time::timeout(Duration::from_secs(1), RpcClient::connect(&path))
            .await
            .expect("busy pipe should become available")
            .expect("client should retry until the next instance exists");
        let second = next.await.unwrap();
        second.connect().await.unwrap();
        drop(client);
        drop(second);

        // The first connected instance remains occupied and no replacement is
        // created. Connection attempts must give up rather than wait forever.
        let client = tokio::time::timeout(Duration::from_secs(3), RpcClient::connect(&path))
            .await
            .expect("busy pipe retries should stop after two seconds");
        assert!(client.is_none());
    }

    #[tokio::test]
    async fn request_timeout_closes_connection() {
        let dir = tempfile::TempDir::new().unwrap();
        #[cfg(unix)]
        let path = dir.path().join("timeout.sock");
        #[cfg(windows)]
        let path = std::path::PathBuf::from(format!(
            r"\\.\pipe\aster-rpc-timeout-{}-{}",
            std::process::id(),
            dir.path().file_name().unwrap().to_string_lossy()
        ));

        #[cfg(unix)]
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        #[cfg(windows)]
        let server = tokio::net::windows::named_pipe::ServerOptions::new()
            .first_pipe_instance(true)
            .create(&path)
            .unwrap();

        let connect = RpcClient::connect(&path);
        let accept = async {
            #[cfg(unix)]
            {
                listener.accept().await.unwrap().0
            }
            #[cfg(windows)]
            {
                server.connect().await.unwrap();
                server
            }
        };
        let (client, server) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(connect, accept)
        })
        .await
        .expect("connect should finish");
        let mut client = client.unwrap();
        let error = client
            .call_with_timeout("unanswered", json!({}), Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("timed out"));
        assert!(client.connection.is_none());
        assert!(client
            .call("another", json!({}))
            .await
            .unwrap_err()
            .to_string()
            .contains("closed"));

        // The peer receives the request followed by EOF, rather than retaining
        // an idle connection after the timeout.
        let mut reader = BufReader::new(server);
        let mut request = String::new();
        let closed = tokio::time::timeout(Duration::from_secs(2), async {
            assert!(reader.read_line(&mut request).await.unwrap() > 0);
            request.clear();
            reader.read_line(&mut request).await
        })
        .await
        .expect("timed-out client should close its transport");
        assert_eq!(closed.unwrap(), 0);
    }
}
