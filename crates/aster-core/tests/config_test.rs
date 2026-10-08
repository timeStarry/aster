use aster_core::config::Config;
use tempfile::TempDir;

#[test]
fn test_config_default_values() {
    let cfg = Config::default();
    assert_eq!(cfg.auto_save_delay_ms, 1000);
    assert!(!cfg.update_check_enabled);
    assert_eq!(cfg.theme, "system");
}

#[test]
fn test_config_roundtrip() {
    let dir = TempDir::new().unwrap();
    std::env::set_var("ASTER_CONFIG_DIR", dir.path());
    let mut cfg = Config::default();
    cfg.auto_save_delay_ms = 2000;
    cfg.save().unwrap();
    let loaded = Config::load().unwrap();
    assert_eq!(loaded.auto_save_delay_ms, 2000);
    std::env::remove_var("ASTER_CONFIG_DIR");
}
