use std::sync::Arc;
use anyhow::Result;
use aster_core::{
    document::DocumentService,
    workspace::WorkspaceService,
    registry::CommandRegistry,
    commands::register_core_commands,
};
use crate::{Cmd, WorkspaceCmd, ExportCmd};

pub fn build_registry() -> CommandRegistry {
    let mut reg = CommandRegistry::new();
    let doc = Arc::new(DocumentService::new());
    let ws = Arc::new(WorkspaceService::new());
    register_core_commands(&mut reg, doc, ws);
    reg
}

pub fn dispatch(cmd: Cmd) -> Result<()> {
    let mut reg = build_registry();
    match cmd {
        Cmd::Read { path } => {
            let result = reg.dispatch("doc.read", serde_json::json!({"path": path}))
                .map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(())
        }
        Cmd::Write { path, expected_hash } => {
            use std::io::Read;
            let mut content = String::new();
            std::io::stdin().read_to_string(&mut content)?;
            let mut params = serde_json::json!({"path": path, "content": content});
            if let Some(h) = expected_hash {
                params["expectedHash"] = serde_json::json!(h);
            }
            let result = reg.dispatch("doc.write", params)
                .map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(())
        }
        Cmd::Outline { path } => {
            let result = reg.dispatch("doc.outline", serde_json::json!({"path": path}))
                .map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(())
        }
        Cmd::Run { id, json } => {
            let params: serde_json::Value = serde_json::from_str(&json)?;
            let result = reg.dispatch(&id, params)
                .map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(())
        }
        Cmd::Workspace(ws_cmd) => {
            match ws_cmd {
                WorkspaceCmd::List { root } => {
                    let svc = WorkspaceService::new();
                    svc.open(std::path::Path::new(&root))
                        .map_err(|e| anyhow::anyhow!("{}: {}", e.code(), e))?;
                    let files = svc.list()
                        .map_err(|e| anyhow::anyhow!("{}: {}", e.code(), e))?;
                    let v: Vec<_> = files.iter().filter_map(|p| p.to_str()).collect();
                    println!("{}", serde_json::to_string_pretty(&serde_json::json!(v))?);
                    Ok(())
                }
            }
        }
        Cmd::Export(exp_cmd) => {
            match exp_cmd {
                ExportCmd::Html { path, output } => {
                    let mut params = serde_json::json!({"path": path});
                    if let Some(o) = output {
                        params["output"] = serde_json::json!(o);
                    }
                    let result = reg.dispatch("export.html", params)
                        .map_err(|e| { eprintln!("{}: {}", e.code(), e); anyhow::anyhow!(e.to_string()) })?;
                    println!("{}", serde_json::to_string_pretty(&result)?);
                    Ok(())
                }
            }
        }
        Cmd::Plugin(_) => {
            eprintln!("Plugin commands require the plugin system (M3).");
            Ok(())
        }
    }
}
