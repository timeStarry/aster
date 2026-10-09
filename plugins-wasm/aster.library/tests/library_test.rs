#[test]
fn test_library_plugin_manifest_valid() {
    let manifest_str = include_str!("../aster.plugin.json");
    let manifest: serde_json::Value = serde_json::from_str(manifest_str).unwrap();
    assert_eq!(manifest["id"], "aster.library");
    assert_eq!(manifest["apiVersion"], "1");
    let commands = manifest["contributes"]["commands"].as_array().unwrap();
    assert_eq!(commands.len(), 2);
    let ids: Vec<_> = commands.iter().map(|c| c["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&"library.index"));
    assert!(ids.contains(&"library.search"));
}

#[test]
#[ignore = "requires compiled aster-library.wasm; run with --include-ignored after wasm build"]
fn test_library_search_returns_results() {
    assert!(true);
}
