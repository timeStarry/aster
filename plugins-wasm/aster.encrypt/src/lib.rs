pub mod crypto;

wit_bindgen::generate!({
    world: "plugin",
    path: "../../wit/aster-plugin.wit",
});

use exports::aster::plugin::guest::Guest;
use std::cell::RefCell;
use zeroize::Zeroizing;

thread_local! {
    static KEY: RefCell<Option<Zeroizing<[u8; 32]>>> = RefCell::new(None);
}

struct EncryptPlugin;

impl Guest for EncryptPlugin {
    fn activate(_settings_json: String) -> Result<(), String> {
        Ok(())
    }

    fn invoke(command_id: String, params_json: String) -> Result<String, String> {
        let params: serde_json::Value = serde_json::from_str(&params_json)
            .map_err(|e| format!("invalid params: {e}"))?;
        match command_id.as_str() {
            "encrypt.setKey" => {
                let hex_str = params["key_hex"].as_str().ok_or("missing key_hex")?;
                let bytes = (0..hex_str.len())
                    .step_by(2)
                    .map(|i| u8::from_str_radix(&hex_str[i..i+2], 16)
                        .map_err(|e| e.to_string()))
                    .collect::<Result<Vec<u8>, _>>()?;
                if bytes.len() != 32 {
                    return Err("key must be 32 bytes (64 hex chars)".into());
                }
                let mut key = Zeroizing::new([0u8; 32]);
                key.copy_from_slice(&bytes);
                KEY.with(|k| *k.borrow_mut() = Some(key));
                Ok("{}".into())
            }
            "encrypt.status" => {
                let active = KEY.with(|k| k.borrow().is_some());
                Ok(serde_json::json!({"active": active}).to_string())
            }
            _ => Err(format!("unknown command: {command_id}")),
        }
    }

    fn transform(hook: String, _path: String, content: Vec<u8>) -> Result<Vec<u8>, String> {
        KEY.with(|k| {
            let guard = k.borrow();
            let key = guard.as_ref().ok_or("no encryption key set")?;
            match hook.as_str() {
                "onAfterRead"  => crypto::decrypt_bytes(key, &content),
                "onBeforeSave" => crypto::encrypt_bytes(key, &content),
                _ => Ok(content),
            }
        })
    }
}

export!(EncryptPlugin);
