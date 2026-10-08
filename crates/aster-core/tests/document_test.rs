use aster_core::document::{DocumentService, LineEnding};
use aster_core::error::AsterError;
use tempfile::TempDir;
use std::fs;

fn svc() -> DocumentService { DocumentService::new() }

#[test]
fn test_read_write_roundtrip() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("a.md");
    fs::write(&path, "# Hello\n").unwrap();
    let doc = svc().read(&path).unwrap();
    assert_eq!(doc.content, "# Hello\n");
    assert!(!doc.hash.is_empty());
}

#[test]
fn test_bom_roundtrip() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("bom.md");
    // UTF-8 BOM
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(b"hello\n");
    fs::write(&path, &bytes).unwrap();
    let doc = svc().read(&path).unwrap();
    assert_eq!(doc.content, "hello\n");
    // Write back — hash of the BOM-prefixed bytes is what we read
    svc().write(&path, &doc.content, Some(&doc.hash)).unwrap();
    let raw = fs::read(&path).unwrap();
    assert_eq!(&raw[..3], &[0xEF, 0xBB, 0xBF], "BOM must be preserved");
}

#[test]
fn test_crlf_roundtrip() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("crlf.md");
    fs::write(&path, "line1\r\nline2\r\n").unwrap();
    let doc = svc().read(&path).unwrap();
    assert_eq!(doc.line_ending, LineEnding::Crlf);
    // content is LF-normalised
    assert!(!doc.content.contains('\r'));
    svc().write(&path, &doc.content, Some(&doc.hash)).unwrap();
    let raw = fs::read(&path).unwrap();
    let s = String::from_utf8(raw).unwrap();
    assert!(s.contains("\r\n"), "CRLF must be preserved on save");
}

#[test]
fn test_conflict_detection() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("c.md");
    fs::write(&path, "v1\n").unwrap();
    let old_hash = svc().hash_of(&path).unwrap();
    fs::write(&path, "v2\n").unwrap(); // external change
    let err = svc().write(&path, "v3\n", Some(&old_hash)).unwrap_err();
    assert!(matches!(err, AsterError::Conflict { .. }));
}

#[test]
fn test_bom_and_crlf_combined() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("bom_crlf.md");
    // UTF-8 BOM + CRLF line endings
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(b"line1\r\nline2\r\n");
    fs::write(&path, &bytes).unwrap();

    let doc = svc().read(&path).unwrap();
    assert!(!doc.content.contains('\r'), "content must be LF-normalised");
    assert_eq!(doc.line_ending, LineEnding::Crlf);

    // Round-trip: BOM and CRLF must both be preserved
    svc().write(&path, &doc.content, Some(&doc.hash)).unwrap();
    let raw = fs::read(&path).unwrap();
    assert_eq!(&raw[..3], &[0xEF, 0xBB, 0xBF], "BOM must survive round-trip");
    let s = String::from_utf8(raw[3..].to_vec()).unwrap();
    assert!(s.contains("\r\n"), "CRLF must survive round-trip");
    assert!(!s.contains("\r\n\r\n") || s == "line1\r\nline2\r\n",
            "no double CRLF corruption");
}

#[test]
fn test_atomic_write_no_tmp_left() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("d.md");
    fs::write(&path, "orig\n").unwrap();
    let doc = svc().read(&path).unwrap();
    svc().write(&path, "updated\n", Some(&doc.hash)).unwrap();
    assert!(path.exists());
    assert!(!path.with_extension("tmp").exists(), ".tmp must be cleaned up after rename");
}
