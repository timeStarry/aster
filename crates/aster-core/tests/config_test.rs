use aster_core::config::Config;
use aster_core::registry::CommandRegistry;
use serde_json::json;
use tempfile::TempDir;

#[test]
fn test_config_default_values() {
    let cfg = Config::default();
    assert_eq!(cfg.auto_save_delay_ms, 1000);
    assert!(cfg.update_check_enabled);
    assert_eq!(cfg.theme, "system");
    assert_eq!(cfg.font_size, 16);
    assert!(cfg.cjk_spacing);
    assert!(cfg.slash_commands);
    assert!(cfg.auto_save);
}

#[test]
fn test_config_roundtrip() {
    let dir = TempDir::new().unwrap();
    std::env::set_var("ASTER_CONFIG_DIR", dir.path());
    let mut cfg = Config::default();
    cfg.auto_save_delay_ms = 2000;
    cfg.theme = "paper".into();
    cfg.font_size = 18;
    cfg.save().unwrap();
    let loaded = Config::load().unwrap();
    assert_eq!(loaded.auto_save_delay_ms, 2000);
    assert_eq!(loaded.theme, "paper");
    assert_eq!(loaded.font_size, 18);

    // Partial legacy config.json without v2 fields still loads cleanly
    std::fs::write(
        dir.path().join("config.json"),
        r#"{"theme":"dark","typewriterScroll":true}"#,
    )
    .unwrap();
    let migrated = Config::load().unwrap();
    assert_eq!(migrated.theme, "dark");
    assert!(migrated.typewriter);
    assert_eq!(migrated.font_size, 16);

    // Commands config.get / config.set merge fields cleanly
    let mut reg = CommandRegistry::new();
    aster_core::commands::config::register(&mut reg);
    let updated = reg
        .dispatch("config.set", json!({ "proseWidth": 820, "focusMode": true }))
        .unwrap();
    assert_eq!(updated["proseWidth"], 820);
    assert_eq!(updated["focusMode"], true);
    assert_eq!(updated["theme"], "dark");

    let fetched = reg.dispatch("config.get", json!({})).unwrap();
    assert_eq!(fetched["existsOnDisk"], true);
    assert_eq!(fetched["proseWidth"], 820);

    std::env::remove_var("ASTER_CONFIG_DIR");
}
