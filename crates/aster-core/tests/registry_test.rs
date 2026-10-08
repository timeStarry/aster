use aster_core::registry::{CommandRegistry, CommandSpec};
use serde_json::json;

#[test]
fn test_register_and_list() {
    let mut reg = CommandRegistry::new();
    reg.register(CommandSpec {
        id: "test.hello".into(),
        description: "Say hello".into(),
        params_schema: json!({"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}),
        returns_schema: json!({"type":"string"}),
        headless: true,
        source: "core".into(),
    });
    let cmds = reg.list();
    assert!(cmds.iter().any(|c| c.id == "test.hello"));
}

#[test]
fn test_dispatch_unknown_returns_not_found() {
    let mut reg = CommandRegistry::new();
    let err = reg.dispatch("nonexistent", serde_json::Value::Null).unwrap_err();
    assert_eq!(err.code(), "E_NOT_FOUND");
}

#[test]
fn test_dispatch_registered_without_handler_returns_needs_gui() {
    let mut reg = CommandRegistry::new();
    reg.register(CommandSpec {
        id: "editor.openFile".into(),
        description: "Open file in GUI".into(),
        params_schema: json!({"type":"object"}),
        returns_schema: json!({"type":"object"}),
        headless: false,
        source: "core".into(),
    });
    let err = reg.dispatch("editor.openFile", json!({})).unwrap_err();
    assert_eq!(err.code(), "E_NEEDS_GUI");
}

#[test]
fn test_dispatch_with_handler_returns_result() {
    let mut reg = CommandRegistry::new();
    reg.register_with_handler(
        CommandSpec {
            id: "test.echo".into(),
            description: "Echo input".into(),
            params_schema: json!({"type":"object"}),
            returns_schema: json!({"type":"string"}),
            headless: true,
            source: "core".into(),
        },
        |params| Ok(params),
    );
    let result = reg.dispatch("test.echo", json!({"msg": "hi"})).unwrap();
    assert_eq!(result["msg"], "hi");
}
