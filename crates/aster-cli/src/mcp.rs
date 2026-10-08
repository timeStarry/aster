use std::io::{BufRead, Write};
use anyhow::Result;
use serde_json::{json, Value};
use aster_core::registry::CommandRegistry;
use aster_rpc::RpcClient;

/// Run the MCP stdio server.
/// Reads newline-delimited JSON-RPC 2.0 from stdin, writes to stdout.
pub async fn run(reg: &mut CommandRegistry) -> Result<()> {
    // Try to connect to the running GUI for forwarding non-headless commands.
    let sock = crate::commands::aster_app_socket_path();
    let mut gui_client: Option<RpcClient> = RpcClient::connect(&sock).await;

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let resp = json!({
                    "jsonrpc": "2.0", "id": null,
                    "error": { "code": -32700, "message": format!("Parse error: {e}") }
                });
                writeln!(out, "{}", serde_json::to_string(&resp)?)?;
                out.flush()?;
                continue;
            }
        };

        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("").to_owned();

        let resp = match method.as_str() {
            "tools/list" => {
                // List all registered commands, mapping '.' to '_' in names
                let tools: Vec<Value> = reg.list().iter().map(|spec| {
                    json!({
                        "name": spec.id.replace('.', "_"),
                        "description": spec.description,
                        "inputSchema": spec.params_schema,
                    })
                }).collect();
                json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tools } })
            }
            "tools/call" => {
                let params = req.get("params").cloned().unwrap_or(json!({}));
                let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let cmd_id = tool_name.replace('_', ".");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));

                // Try GUI first (handles editor.* commands), fall back to headless
                let result = if let Some(ref mut client) = gui_client {
                    client.call(&cmd_id, args.clone()).await
                } else {
                    Err(aster_core::error::AsterError::NeedsGui { hint: "GUI not running".into() })
                };

                let result = match result {
                    Ok(v) => Ok(v),
                    Err(e) if e.code() == "E_NEEDS_GUI" => {
                        // Re-try headless (catches commands like doc.read that don't need GUI)
                        reg.dispatch(&cmd_id, args)
                    }
                    Err(e) => Err(e),
                };

                match result {
                    Ok(v) => json!({
                        "jsonrpc": "2.0", "id": id,
                        "result": { "content": [{ "type": "text", "text": v.to_string() }] }
                    }),
                    Err(e) => json!({
                        "jsonrpc": "2.0", "id": id,
                        "error": {
                            "code": if e.code() == "E_NOT_FOUND" { -32601i64 } else { -32000i64 },
                            "message": e.to_string(),
                            "data": { "code": e.code(), "message": e.to_string() }
                        }
                    }),
                }
            }
            _ => json!({
                "jsonrpc": "2.0", "id": id,
                "error": { "code": -32601, "message": format!("Method not found: {method}") }
            }),
        };

        writeln!(out, "{}", serde_json::to_string(&resp)?)?;
        out.flush()?;
    }

    Ok(())
}
