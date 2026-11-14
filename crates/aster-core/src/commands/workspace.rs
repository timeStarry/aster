use crate::{
    error::AsterError,
    registry::{CommandRegistry, CommandSpec},
    workspace::WorkspaceService,
};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;

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
                let path = params
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AsterError::InvalidParams("missing field: path".into()))?;
                let canon = w.open(Path::new(path))?;
                Ok(json!({ "root": canon.to_string_lossy() }))
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
                let paths: Vec<String> = files
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                Ok(json!(paths))
            },
        );
    }

    {
        let w = Arc::clone(&ws);
        registry.register_with_handler(
            CommandSpec {
                id: "workspace.tree".into(),
                description: "Return hierarchical folder tree of Markdown files in the workspace".into(),
                params_schema: json!({"type":"object"}),
                returns_schema: json!({"type":"object","properties":{"root":{"type":"string"},"nodes":{"type":"array"}}}),
                headless: true,
                source: "core".into(),
            },
            move |_| {
                let root = w
                    .root()
                    .ok_or_else(|| AsterError::NotFound("workspace not open".into()))?;
                let nodes = w.tree()?;
                Ok(json!({
                    "root": root.to_string_lossy(),
                    "nodes": nodes,
                }))
            },
        );
    }

    {
        let w = Arc::clone(&ws);
        registry.register_with_handler(
            CommandSpec {
                id: "workspace.search".into(),
                description: "Full-text search across Markdown files in the workspace".into(),
                params_schema: json!({
                    "type":"object",
                    "properties":{
                        "query":{"type":"string"},
                        "caseSensitive":{"type":"boolean"},
                        "maxResults":{"type":"integer"}
                    },
                    "required":["query"]
                }),
                returns_schema: json!({"type":"array"}),
                headless: true,
                source: "core".into(),
            },
            move |params| {
                let query = params
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let case_sensitive = params
                    .get("caseSensitive")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let max_results = params
                    .get("maxResults")
                    .and_then(Value::as_u64)
                    .unwrap_or(200) as usize;
                let hits = w.search(query, case_sensitive, max_results)?;
                Ok(serde_json::to_value(hits).unwrap_or_else(|_| json!([])))
            },
        );
    }

    {
        let w = Arc::clone(&ws);
        registry.register_with_handler(
            CommandSpec {
                id: "workspace.createFile".into(),
                description: "Create a new Markdown file inside the open workspace".into(),
                params_schema: json!({
                    "type":"object",
                    "properties":{"relPath":{"type":"string"}},
                    "required":["relPath"]
                }),
                returns_schema: json!({"type":"object","properties":{"path":{"type":"string"}}}),
                headless: true,
                source: "core".into(),
            },
            move |params| {
                let rel_path = params
                    .get("relPath")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AsterError::InvalidParams("missing field: relPath".into()))?;
                let created = w.create_file(rel_path)?;
                Ok(json!({ "path": created.to_string_lossy() }))
            },
        );
    }
}
