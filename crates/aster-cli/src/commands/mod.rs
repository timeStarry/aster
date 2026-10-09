use std::sync::{Arc, Mutex};
use anyhow::Result;
use serde_json::Value;
use aster_core::{
    document::DocumentService,
    workspace::WorkspaceService,
    plugin::PluginHost,
    registry::CommandRegistry,
    commands::register_core_commands,
    error::AsterResult,
};
use aster_rpc::RpcClient;
use crate::{Cmd, WorkspaceCmd, ExportCmd};

pub fn build_registry() -> CommandRegistry {
    let mut reg = CommandRegistry::new();
    let doc = Arc::new(DocumentService::new());
    let ws = Arc::new(WorkspaceService::new());
    let mut host = PluginHost::new().expect("wasmtime init failed");
    let user_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".aster/plugins");
    let _ = host.load_dir(&user_dir, aster_core::plugin::PluginSource::User);
    let host = Arc::new(Mutex::new(host));
    register_core_commands(&mut reg, doc, ws, host);
    reg
}

/// Try to call a command via the running GUI socket; fall back to headless.
async fn try_gui_or_headless(
    id: &str,
    params: Value,
    reg: &mut CommandRegistry,
) -> AsterResult<Value> {
    let sock = aster_app_socket_path();
    if let Some(mut client) = RpcClient::connect(&sock).await {
        client.call(id, params).await
    } else {
        reg.dispatch(id, params)
    }
}

/// Platform-specific socket path — must match aster-app's rpc::socket_path().
pub fn aster_app_socket_path() -> std::path::PathBuf {
    #[cfg(unix)]
    {
        if let Some(runtime_dir) = dirs::runtime_dir() {
            return runtime_dir.join("aster.sock");
        }
        dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
            .join(".aster/run/aster.sock")
    }
    #[cfg(windows)]
    {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        std::path::PathBuf::from(format!(r"\\.\pipe\aster-{user}"))
    }
}

pub fn dispatch(cmd: Cmd) -> Result<()> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(dispatch_async(cmd))
}

async fn dispatch_async(cmd: Cmd) -> Result<()> {
    let mut reg = build_registry();
    match cmd {
        Cmd::Mcp => {
            crate::mcp::run(&mut reg).await?;
            return Ok(());
        }
        Cmd::Read { path } => {
            let result = try_gui_or_headless(
                "doc.read",
                serde_json::json!({"path": path}),
                &mut reg,
            ).await.map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Write { path, expected_hash } => {
            use tokio::io::AsyncReadExt;
            let mut content = String::new();
            tokio::io::stdin().read_to_string(&mut content).await?;
            let mut params = serde_json::json!({"path": path, "content": content});
            if let Some(h) = expected_hash {
                params["expectedHash"] = serde_json::json!(h);
            }
            let result = try_gui_or_headless("doc.write", params, &mut reg)
                .await.map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Outline { path } => {
            let result = try_gui_or_headless(
                "doc.outline",
                serde_json::json!({"path": path}),
                &mut reg,
            ).await.map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Run { id, json } => {
            let params: serde_json::Value = serde_json::from_str(&json)?;
            let result = try_gui_or_headless(&id, params, &mut reg)
                .await.map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Workspace(WorkspaceCmd::List { root }) => {
            // open workspace first, then list
            try_gui_or_headless(
                "workspace.open",
                serde_json::json!({"path": root}),
                &mut reg,
            ).await.map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            let result = try_gui_or_headless(
                "workspace.list",
                serde_json::json!({}),
                &mut reg,
            ).await.map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Export(ExportCmd::Html { path, output }) => {
            let mut params = serde_json::json!({"path": path});
            if let Some(o) = output {
                params["output"] = serde_json::json!(o);
            }
            let result = try_gui_or_headless("export.html", params, &mut reg)
                .await.map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Plugin(crate::PluginCmd::List) => {
            let result = try_gui_or_headless("plugin.list", serde_json::json!({}), &mut reg)
                .await.map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
