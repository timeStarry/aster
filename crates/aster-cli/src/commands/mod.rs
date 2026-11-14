use crate::{Cmd, ExportCmd, WorkspaceCmd};
use anyhow::Result;
use aster_core::{
    commands::register_core_commands,
    document::DocumentService,
    error::AsterResult,
    plugin::PluginHost,
    registry::CommandRegistry,
    workspace::WorkspaceService,
};
use aster_rpc::RpcClient;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

pub fn build_registry() -> CommandRegistry {
    let mut reg = CommandRegistry::new();
    let doc = Arc::new(DocumentService::new());
    let ws = Arc::new(WorkspaceService::new());
    let mut host = PluginHost::new().expect("plugin host init failed");
    let user_dir = dirs::home_dir().unwrap_or_default().join(".aster/plugins");
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
pub fn aster_app_socket_path() -> PathBuf {
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

fn resolve_abs_path(raw: &str) -> PathBuf {
    let p = PathBuf::from(raw);
    let joined = if p.is_absolute() {
        p
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(p)
    };
    std::fs::canonicalize(&joined).unwrap_or(joined)
}

pub fn launch_gui(file: Option<&Path>) -> Result<()> {
    // 1. Check sibling `aster-app` binary next to `aster` CLI executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bin_name = if cfg!(windows) { "aster-app.exe" } else { "aster-app" };
            let candidate = dir.join(bin_name);
            if candidate.is_file() {
                let mut cmd = Command::new(candidate);
                if let Some(f) = file {
                    cmd.arg(f);
                }
                cmd.stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()?;
                return Ok(());
            }
        }
    }

    // 2. macOS `.app` bundle fallback (`open -a Aster <file>`)
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.args(["-a", "Aster"]);
        if let Some(f) = file {
            cmd.arg(f);
        }
        let status = cmd.status()?;
        if status.success() {
            return Ok(());
        }
    }

    anyhow::bail!("Aster GUI is not running and `aster-app` binary was not found in PATH")
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
        Cmd::Open { path } => {
            let abs = resolve_abs_path(&path);
            let abs_str = abs.to_string_lossy().into_owned();
            let sock = aster_app_socket_path();
            if let Some(mut client) = RpcClient::connect(&sock).await {
                client
                    .call("editor.openFile", serde_json::json!({ "path": abs_str }))
                    .await
                    .map_err(|e| anyhow::anyhow!("{}: {}", e.code(), e))?;
            } else {
                launch_gui(Some(&abs))?;
            }
        }
        Cmd::Read { path } => {
            let result = try_gui_or_headless(
                "doc.read",
                serde_json::json!({"path": path}),
                &mut reg,
            )
            .await
            .map_err(|e| {
                eprintln!("{}: {}", e.code(), e);
                anyhow::anyhow!(e.to_string())
            })?;
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
                .await
                .map_err(|e| {
                    eprintln!("{}: {}", e.code(), e);
                    anyhow::anyhow!(e.to_string())
                })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Outline { path } => {
            let result = try_gui_or_headless(
                "doc.outline",
                serde_json::json!({"path": path}),
                &mut reg,
            )
            .await
            .map_err(|e| {
                eprintln!("{}: {}", e.code(), e);
                anyhow::anyhow!(e.to_string())
            })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Run { id, json } => {
            let params: serde_json::Value = serde_json::from_str(&json)?;
            let result = try_gui_or_headless(&id, params, &mut reg)
                .await
                .map_err(|e| {
                    eprintln!("{}: {}", e.code(), e);
                    anyhow::anyhow!(e.to_string())
                })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Workspace(WorkspaceCmd::List { root }) => {
            try_gui_or_headless(
                "workspace.open",
                serde_json::json!({"path": root}),
                &mut reg,
            )
            .await
            .map_err(|e| {
                eprintln!("{}: {}", e.code(), e);
                anyhow::anyhow!(e.to_string())
            })?;
            let result = try_gui_or_headless("workspace.list", serde_json::json!({}), &mut reg)
                .await
                .map_err(|e| {
                    eprintln!("{}: {}", e.code(), e);
                    anyhow::anyhow!(e.to_string())
                })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Export(ExportCmd::Html { path, output }) => {
            let mut params = serde_json::json!({"path": path});
            if let Some(o) = output {
                params["output"] = serde_json::json!(o);
            }
            let result = try_gui_or_headless("export.html", params, &mut reg)
                .await
                .map_err(|e| {
                    eprintln!("{}: {}", e.code(), e);
                    anyhow::anyhow!(e.to_string())
                })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Cmd::Plugin(crate::PluginCmd::List) => {
            let result = try_gui_or_headless("plugin.list", serde_json::json!({}), &mut reg)
                .await
                .map_err(|e| {
                    eprintln!("{}: {}", e.code(), e);
                    anyhow::anyhow!(e.to_string())
                })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
