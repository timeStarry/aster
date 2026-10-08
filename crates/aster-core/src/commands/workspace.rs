use std::sync::Arc;
use std::path::Path;
use serde_json::{json, Value};
use crate::{
    workspace::WorkspaceService,
    registry::{CommandRegistry, CommandSpec},
    error::AsterResult,
};

pub fn register(registry: &mut CommandRegistry, ws: Arc<WorkspaceService>) {
    {
        let w = Arc::clone(&ws);
        registry.register_with_handler(
            CommandSpec {
                id: "workspace.open".into(),
                description: "Set the workspace root to a directory".into(),
                params_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
                returns_schema: json!({"type":"object","properties":{"root":{"type":"string"}}}),
                headless: true,
                source: "core".into(),
            },
            move |params| {
                let path = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                w.open(Path::new(path))?;
                Ok(json!({"root": path}))
            },
        );
    }
    {
        let w = Arc::clone(&ws);
        registry.register_with_handler(
            CommandSpec {
                id: "workspace.list".into(),
                description: "List Markdown files in the workspace".into(),
                params_schema: json!({"type":"object"}),
                returns_schema: json!({"type":"array","items":{"type":"string"}}),
                headless: true,
                source: "core".into(),
            },
            move |_| {
                let files = w.list()?;
                let paths: Vec<_> = files.iter()
                    .filter_map(|p| p.to_str())
                    .collect();
                Ok(json!(paths))
            },
        );
    }
}
