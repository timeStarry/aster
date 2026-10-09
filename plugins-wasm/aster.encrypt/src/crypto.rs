use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};

pub fn encrypt_bytes(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext).map_err(|e| e.to_string())?;
    // Prepend 12-byte nonce
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt_bytes(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("data too short for nonce".into());
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher.decrypt(nonce, ciphertext).map_err(|e| e.to_string())
}
