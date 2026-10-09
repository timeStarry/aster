#[test]
fn test_encrypt_plugin_manifest_valid() {
    let manifest_str = include_str!("../aster.plugin.json");
    let manifest: serde_json::Value = serde_json::from_str(manifest_str).unwrap();
    assert_eq!(manifest["id"], "aster.encrypt");
    assert_eq!(manifest["apiVersion"], "1");
    let hooks = manifest["contributes"]["hooks"].as_array().unwrap();
    assert!(hooks.iter().any(|h| h == "onAfterRead"));
    assert!(hooks.iter().any(|h| h == "onBeforeSave"));
}

#[test]
fn test_encrypt_roundtrip() {
    use aster_encrypt::crypto::{encrypt_bytes, decrypt_bytes};
    let key = [0u8; 32];
    let plaintext = b"hello world";
    let ciphertext = encrypt_bytes(&key, plaintext).unwrap();
    assert_ne!(ciphertext, plaintext);
    let decrypted = decrypt_bytes(&key, &ciphertext).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[test]
fn test_encrypt_wrong_key_fails() {
    use aster_encrypt::crypto::{encrypt_bytes, decrypt_bytes};
    let key1 = [0u8; 32];
    let key2 = [1u8; 32];
    let ciphertext = encrypt_bytes(&key1, b"secret").unwrap();
    let result = decrypt_bytes(&key2, &ciphertext);
    assert!(result.is_err());
}
