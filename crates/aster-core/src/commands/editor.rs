use serde_json::{json, Value};
use crate::{
    registry::{CommandRegistry, CommandSpec},
    error::AsterResult,
};

/// Register editor.* command specs (no handlers — dispatched to GUI via RPC).
/// These are spec-only: CLI/MCP sees them in tools/list, and forwarding to
/// the GUI socket is handled by the MCP server and CLI dispatcher.
pub fn register(registry: &mut CommandRegistry) {
    registry.register(CommandSpec {
        id: "editor.openFile".into(),
        description: "Open a file in the GUI editor".into(),
        params_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
        returns_schema: json!({"type":"object","properties":{"ok":{"type":"boolean"}}}),
        headless: false,
        source: "core".into(),
    });

    registry.register(CommandSpec {
        id: "editor.getSelection".into(),
        description: "Return the current editor selection { anchor, head, content }".into(),
        params_schema: json!({"type":"object"}),
        returns_schema: json!({"type":"object","properties":{"anchor":{"type":"integer"},"head":{"type":"integer"},"content":{"type":"string"}}}),
        headless: false,
        source: "core".into(),
    });

    registry.register(CommandSpec {
        id: "editor.insert".into(),
        description: "Insert text at the cursor or at a specified position".into(),
        params_schema: json!({"type":"object","properties":{"text":{"type":"string"},"position":{"type":"integer"}},"required":["text"]}),
        returns_schema: json!({"type":"object","properties":{"ok":{"type":"boolean"}}}),
        headless: false,
        source: "core".into(),
    });
}
