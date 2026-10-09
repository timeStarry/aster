use ed25519_dalek::{VerifyingKey, Signature, Verifier};
use crate::error::{AsterError, AsterResult};

/// Official Aster plugin signing public key (Ed25519, hex-encoded).
/// Plugins distributed by the Aster project are signed with the corresponding
/// private key. This key is embedded at compile time.
const OFFICIAL_VERIFYING_KEY_HEX: &str =
    "dfc42baea50a67c101b2c3e65ab449b3904b1c9edd03a50d2edfab0453b30760";

/// The filename that carries the Ed25519 signature for a plugin bundle.
/// Content: hex-encoded 64-byte Ed25519 signature over the manifest bytes.
pub const SIGNATURE_FILE: &str = "aster.plugin.sig";

/// Outcome of signature verification for a plugin directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureStatus {
    /// Signed by the embedded official key — fully trusted.
    Official,
    /// No signature file present — user must confirm installation.
    Unsigned,
}

/// Verify the Ed25519 signature of a plugin manifest.
///
/// Reads `aster.plugin.sig` from `plugin_dir` and verifies it against
/// the raw bytes of `aster.plugin.json` using the embedded official key.
/// Returns `SignatureStatus::Unsigned` when no sig file is present.
/// Returns an error when a sig file is present but invalid.
pub fn verify_plugin_signature(plugin_dir: &std::path::Path) -> AsterResult<SignatureStatus> {
    let sig_path = plugin_dir.join(SIGNATURE_FILE);
    if !sig_path.exists() {
        return Ok(SignatureStatus::Unsigned);
    }

    let sig_hex = std::fs::read_to_string(&sig_path)
        .map_err(|e| AsterError::Io(format!("cannot read signature file: {e}")))?;
    let sig_hex = sig_hex.trim();

    let sig_bytes = hex::decode(sig_hex)
        .map_err(|_| AsterError::InvalidParams("plugin signature is not valid hex".into()))?;
    if sig_bytes.len() != 64 {
        return Err(AsterError::InvalidParams(
            format!("plugin signature has wrong length: {} bytes (expected 64)", sig_bytes.len())
        ));
    }
    let sig_array: [u8; 64] = sig_bytes.try_into().unwrap();
    let sig = Signature::from_bytes(&sig_array);

    let key_bytes = hex::decode(OFFICIAL_VERIFYING_KEY_HEX)
        .expect("built-in verifying key is valid hex; this is a compile-time constant");
    let key_array: [u8; 32] = key_bytes.try_into()
        .expect("built-in verifying key is 32 bytes");
    let vk = VerifyingKey::from_bytes(&key_array)
        .map_err(|e| AsterError::Io(format!("built-in key invalid: {e}")))?;

    let manifest_bytes = std::fs::read(plugin_dir.join("aster.plugin.json"))
        .map_err(|e| AsterError::Io(format!("cannot read manifest for signature check: {e}")))?;

    vk.verify(&manifest_bytes, &sig)
        .map_err(|_| AsterError::InvalidParams(
            "plugin signature verification failed — manifest may have been tampered with".into()
        ))?;

    Ok(SignatureStatus::Official)
}

/// Sign a plugin manifest with the given signing key bytes (hex-encoded).
/// Used by the Aster release toolchain; not exposed in the public API.
#[cfg(test)]
pub(crate) fn sign_manifest(plugin_dir: &std::path::Path, signing_key_hex: &str) -> AsterResult<()> {
    use ed25519_dalek::{SigningKey, Signer};

    let sk_bytes = hex::decode(signing_key_hex)
        .map_err(|_| AsterError::InvalidParams("signing key is not valid hex".into()))?;
    let sk_array: [u8; 32] = sk_bytes.try_into()
        .map_err(|_| AsterError::InvalidParams("signing key must be 32 bytes".into()))?;
    let sk = SigningKey::from_bytes(&sk_array);
    let manifest_bytes = std::fs::read(plugin_dir.join("aster.plugin.json"))
        .map_err(|e| AsterError::Io(e.to_string()))?;
    let sig: Signature = sk.sign(&manifest_bytes);
    std::fs::write(plugin_dir.join(SIGNATURE_FILE), hex::encode(sig.to_bytes()))
        .map_err(|e| AsterError::Io(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const TEST_SK_HEX: &str =
        "cbcaf0f9ae17fb3a1f351a10943245d4abb728dee41fa274c18821f9549861c8";

    fn write_manifest(dir: &std::path::Path) {
        std::fs::write(dir.join("aster.plugin.json"),
            br#"{"id":"test.plugin","name":"Test","version":"1.0.0","apiVersion":"1","description":"test","permissions":[],"activation":[],"contributes":{}}"#
        ).unwrap();
    }

    #[test]
    fn unsigned_plugin_returns_unsigned_status() {
        let tmp = TempDir::new().unwrap();
        write_manifest(tmp.path());
        assert_eq!(verify_plugin_signature(tmp.path()).unwrap(), SignatureStatus::Unsigned);
    }

    #[test]
    fn valid_signature_verifies() {
        let tmp = TempDir::new().unwrap();
        write_manifest(tmp.path());
        sign_manifest(tmp.path(), TEST_SK_HEX).unwrap();
        assert_eq!(verify_plugin_signature(tmp.path()).unwrap(), SignatureStatus::Official);
    }

    #[test]
    fn tampered_manifest_fails_verification() {
        let tmp = TempDir::new().unwrap();
        write_manifest(tmp.path());
        sign_manifest(tmp.path(), TEST_SK_HEX).unwrap();
        // Tamper with manifest after signing
        std::fs::write(tmp.path().join("aster.plugin.json"),
            br#"{"id":"evil.plugin","name":"Evil","version":"1.0.0","apiVersion":"1","description":"bad","permissions":["fs:any"],"activation":[],"contributes":{}}"#
        ).unwrap();
        assert!(verify_plugin_signature(tmp.path()).is_err());
    }

    #[test]
    fn invalid_hex_sig_returns_error() {
        let tmp = TempDir::new().unwrap();
        write_manifest(tmp.path());
        std::fs::write(tmp.path().join(SIGNATURE_FILE), "notvalidhex!!!").unwrap();
        assert!(verify_plugin_signature(tmp.path()).is_err());
    }

    #[test]
    fn wrong_length_sig_returns_error() {
        let tmp = TempDir::new().unwrap();
        write_manifest(tmp.path());
        std::fs::write(tmp.path().join(SIGNATURE_FILE), "deadbeef").unwrap();
        assert!(verify_plugin_signature(tmp.path()).is_err());
    }
}
