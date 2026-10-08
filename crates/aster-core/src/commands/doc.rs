use std::sync::Arc;
use std::path::Path;
use serde_json::{json, Value};
use crate::{
    document::DocumentService,
    registry::{CommandRegistry, CommandSpec},
    error::{AsterError, AsterResult},
};

pub fn register(registry: &mut CommandRegistry, doc: Arc<DocumentService>) {
    // doc.read
    {
        let d = Arc::clone(&doc);
        registry.register_with_handler(
            CommandSpec {
                id: "doc.read".into(),
                description: "Read a Markdown file and return its content and SHA-256 hash".into(),
                params_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
                returns_schema: json!({"type":"object","properties":{"content":{"type":"string"},"hash":{"type":"string"}}}),
                headless: true,
                source: "core".into(),
            },
            move |params| {
                let path = get_str(&params, "path")?;
                let doc_content = d.read(Path::new(&path))?;
                Ok(json!({"content": doc_content.content, "hash": doc_content.hash}))
            },
        );
    }

    // doc.write
    {
        let d = Arc::clone(&doc);
        registry.register_with_handler(
            CommandSpec {
                id: "doc.write".into(),
                description: "Write content to a Markdown file atomically".into(),
                params_schema: json!({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"},"expectedHash":{"type":"string"}},"required":["path","content"]}),
                returns_schema: json!({"type":"object","properties":{"hash":{"type":"string"}}}),
                headless: true,
                source: "core".into(),
            },
            move |params| {
                let path = get_str(&params, "path")?;
                let content = get_str(&params, "content")?;
                let expected = params.get("expectedHash").and_then(|v| v.as_str()).map(|s| s.to_owned());
                let new_hash = d.write(Path::new(&path), &content, expected.as_deref())?;
                Ok(json!({"hash": new_hash}))
            },
        );
    }

    // doc.outline
    {
        let d = Arc::clone(&doc);
        registry.register_with_handler(
            CommandSpec {
                id: "doc.outline".into(),
                description: "Return the heading tree of a Markdown file".into(),
                params_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
                returns_schema: json!({"type":"array"}),
                headless: true,
                source: "core".into(),
            },
            move |params| {
                let path = get_str(&params, "path")?;
                let doc_content = d.read(Path::new(&path))?;
                Ok(json!(extract_outline(&doc_content.content)))
            },
        );
    }

    // doc.patch — spec-only in M1; handler implemented in M2
    registry.register(CommandSpec {
        id: "doc.patch".into(),
        description: "Apply one or more targeted edits to a document atomically".into(),
        params_schema: json!({"type":"object","properties":{"path":{"type":"string"},"expectedHash":{"type":"string"},"edits":{"type":"array"}},"required":["path","edits"]}),
        returns_schema: json!({"type":"object","properties":{"hash":{"type":"string"}}}),
        headless: true,
        source: "core".into(),
    });
}

fn get_str(params: &Value, key: &str) -> AsterResult<String> {
    params.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_owned())
        .ok_or_else(|| AsterError::InvalidParams(format!("missing field: {key}")))
}

#[derive(serde::Serialize)]
struct HeadingNode {
    level: usize,
    text: String,
    line: usize,
}

fn extract_outline(content: &str) -> Vec<HeadingNode> {
    content.lines().enumerate().filter_map(|(i, line)| {
        if line.starts_with('#') {
            let level = line.chars().take_while(|&c| c == '#').count();
            let text = line[level..].trim().to_owned();
            Some(HeadingNode { level, text, line: i + 1 })
        } else {
            None
        }
    }).collect()
}
