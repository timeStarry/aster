use std::sync::Arc;
use std::path::Path;
use serde_json::{json, Value};
use crate::{
    document::DocumentService,
    registry::{CommandRegistry, CommandSpec},
    error::AsterResult,
};

pub fn register(registry: &mut CommandRegistry, doc: Arc<DocumentService>) {
    let d = Arc::clone(&doc);
    registry.register_with_handler(
        CommandSpec {
            id: "export.html".into(),
            description: "Export a Markdown file to a standalone HTML file".into(),
            params_schema: json!({"type":"object","properties":{"path":{"type":"string"},"output":{"type":"string"}},"required":["path"]}),
            returns_schema: json!({"type":"object","properties":{"output":{"type":"string"}}}),
            headless: true,
            source: "core".into(),
        },
        move |params| {
            let path = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let doc_content = d.read(Path::new(path))?;
            let html = minimal_md_to_html(&doc_content.content);
            let out_path = params.get("output")
                .and_then(|v| v.as_str())
                .map(|s| s.to_owned())
                .unwrap_or_else(|| format!("{}.html", path));
            std::fs::write(&out_path, html.as_bytes())?;
            Ok(json!({"output": out_path}))
        },
    );
}

fn minimal_md_to_html(md: &str) -> String {
    let mut html = String::from(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><pre>"
    );
    for c in md.chars() {
        match c {
            '<' => html.push_str("&lt;"),
            '>' => html.push_str("&gt;"),
            '&' => html.push_str("&amp;"),
            c => html.push(c),
        }
    }
    html.push_str("</pre></body></html>");
    html
}
