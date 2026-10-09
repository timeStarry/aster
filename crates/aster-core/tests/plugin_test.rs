use std::fs;
use tempfile::TempDir;
use aster_core::plugin::{PluginHost, PluginSource};

fn write_manifest(dir: &std::path::Path, id: &str, name: &str) {
    let plugin_dir = dir.join(id);
    fs::create_dir_all(&plugin_dir).unwrap();
    let manifest = serde_json::json!({
        "id": id,
        "name": name,
        "version": "1.0.0",
        "apiVersion": "1",
        "description": "test plugin",
        "permissions": [],
        "activation": ["onStartup"],
        "contributes": {}
    });
    fs::write(plugin_dir.join("aster.plugin.json"), manifest.to_string()).unwrap();
}

#[test]
fn test_load_dir_finds_plugins() {
    let dir = TempDir::new().unwrap();
    write_manifest(dir.path(), "aster.foo", "Foo Plugin");
    write_manifest(dir.path(), "aster.bar", "Bar Plugin");

    let mut host = PluginHost::new().unwrap();
    host.load_dir(dir.path(), PluginSource::User).unwrap();

    let list = host.list();
    assert_eq!(list.len(), 2);
    let ids: Vec<_> = list.iter().map(|p| p.id.as_str()).collect();
    assert!(ids.contains(&"aster.foo"));
    assert!(ids.contains(&"aster.bar"));
}

#[test]
fn test_invalid_manifest_skipped() {
    let dir = TempDir::new().unwrap();
    write_manifest(dir.path(), "aster.good", "Good");
    // Bad plugin — missing required fields
    let bad = dir.path().join("bad.plugin");
    fs::create_dir_all(&bad).unwrap();
    fs::write(bad.join("aster.plugin.json"), r#"{"id": "bad"}"#).unwrap();

    let mut host = PluginHost::new().unwrap();
    host.load_dir(dir.path(), PluginSource::User).unwrap();

    assert_eq!(host.list().len(), 1);
    assert_eq!(host.list()[0].id, "aster.good");
}

#[test]
fn test_user_overrides_builtin() {
    let builtin_dir = TempDir::new().unwrap();
    let user_dir = TempDir::new().unwrap();
    write_manifest(builtin_dir.path(), "aster.x", "Builtin X v1");
    write_manifest(user_dir.path(), "aster.x", "User X v2");

    let mut host = PluginHost::new().unwrap();
    host.load_dir(builtin_dir.path(), PluginSource::Builtin).unwrap();
    host.load_dir(user_dir.path(), PluginSource::User).unwrap();

    assert_eq!(host.list().len(), 1);
    assert!(matches!(host.list()[0].source, PluginSource::User));
    assert_eq!(host.list()[0].name, "User X v2");
}

#[test]
fn test_official_plugins_valid() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap().parent().unwrap()
        .join("plugins");
    if !manifest_dir.exists() { return; }
    let mut host = PluginHost::new().unwrap();
    host.load_dir(&manifest_dir, PluginSource::Builtin).unwrap();
    let list = host.list();
    assert!(list.len() >= 3, "expected at least 3 official plugins, got {}", list.len());
    let ids: Vec<_> = list.iter().map(|p| p.id.as_str()).collect();
    assert!(ids.contains(&"aster.theme-dark"), "missing aster.theme-dark");
    assert!(ids.contains(&"aster.mermaid"), "missing aster.mermaid");
    assert!(ids.contains(&"aster.math"), "missing aster.math");
}
