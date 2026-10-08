use aster_core::document::{DocumentService, LineEnding, PatchEdit, PatchPosition, LineRange, Anchor};
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
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(b"hello\n");
    fs::write(&path, &bytes).unwrap();
    let doc = svc().read(&path).unwrap();
    assert_eq!(doc.content, "hello\n");
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
    fs::write(&path, "v2\n").unwrap();
    let err = svc().write(&path, "v3\n", Some(&old_hash)).unwrap_err();
    assert!(matches!(err, AsterError::Conflict { .. }));
}

#[test]
fn test_bom_and_crlf_combined() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("bom_crlf.md");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(b"line1\r\nline2\r\n");
    fs::write(&path, &bytes).unwrap();
    let doc = svc().read(&path).unwrap();
    assert!(!doc.content.contains('\r'), "content must be LF-normalised");
    assert_eq!(doc.line_ending, LineEnding::Crlf);
    svc().write(&path, &doc.content, Some(&doc.hash)).unwrap();
    let raw = fs::read(&path).unwrap();
    assert_eq!(&raw[..3], &[0xEF, 0xBB, 0xBF], "BOM must survive round-trip");
    let s = String::from_utf8(raw[3..].to_vec()).unwrap();
    assert!(s.contains("\r\n"), "CRLF must survive round-trip");
    assert!(!s.contains("\r\n\r\n") || s == "line1\r\nline2\r\n", "no double CRLF corruption");
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

// ── patch tests ──────────────────────────────────────────────────────────────

#[test]
fn test_patch_range_basic() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p.md");
    fs::write(&path, "line1\nline2\nline3\nline4\nline5\n").unwrap();
    svc().patch(&path, &[
        PatchEdit::Range { range: LineRange { start_line: 2, end_line: 3 }, text: "replaced\n".into() },
    ], None).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "line1\nreplaced\nline4\nline5\n");
}

#[test]
fn test_patch_anchor_after() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p.md");
    fs::write(&path, "# Intro\n## TODO\nsome text\n").unwrap();
    svc().patch(&path, &[
        PatchEdit::Anchor {
            anchor: Anchor { find: "## TODO".into(), occurrence: 1, position: PatchPosition::After },
            text: "- new item\n".into(),
        },
    ], None).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Intro\n## TODO\n- new item\nsome text\n");
}

#[test]
fn test_patch_anchor_before() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p.md");
    fs::write(&path, "# Intro\n## TODO\nsome text\n").unwrap();
    svc().patch(&path, &[
        PatchEdit::Anchor {
            anchor: Anchor { find: "## TODO".into(), occurrence: 1, position: PatchPosition::Before },
            text: "- inserted before\n".into(),
        },
    ], None).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Intro\n- inserted before\n## TODO\nsome text\n");
}

#[test]
fn test_patch_anchor_replace() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p.md");
    fs::write(&path, "# Intro\n## TODO\nsome text\n").unwrap();
    svc().patch(&path, &[
        PatchEdit::Anchor {
            anchor: Anchor { find: "## TODO".into(), occurrence: 1, position: PatchPosition::Replace },
            text: "## DONE\n".into(),
        },
    ], None).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Intro\n## DONE\nsome text\n");
}

#[test]
fn test_patch_conflict() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p.md");
    fs::write(&path, "v1\n").unwrap();
    let old_hash = svc().hash_of(&path).unwrap();
    fs::write(&path, "v2\n").unwrap(); // external change
    let err = svc().patch(&path, &[
        PatchEdit::Range { range: LineRange { start_line: 1, end_line: 1 }, text: "v3\n".into() },
    ], Some(&old_hash)).unwrap_err();
    assert!(matches!(err, AsterError::Conflict { .. }));
    assert_eq!(fs::read_to_string(&path).unwrap(), "v2\n");
}

#[test]
fn test_patch_anchor_not_found() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p.md");
    fs::write(&path, "# Intro\nsome text\n").unwrap();
    let err = svc().patch(&path, &[
        PatchEdit::Anchor {
            anchor: Anchor { find: "## TODO".into(), occurrence: 1, position: PatchPosition::After },
            text: "- new\n".into(),
        },
    ], None).unwrap_err();
    assert!(matches!(err, AsterError::AnchorNotFound(_)));
    assert_eq!(fs::read_to_string(&path).unwrap(), "# Intro\nsome text\n");
}

#[test]
fn test_patch_multi_edits_atomic() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("p.md");
    fs::write(&path, "# Intro\n## TODO\nsome text\n").unwrap();
    let original = fs::read_to_string(&path).unwrap();
    // First edit valid, second references non-existent anchor → whole patch must fail
    let err = svc().patch(&path, &[
        PatchEdit::Anchor {
            anchor: Anchor { find: "## TODO".into(), occurrence: 1, position: PatchPosition::After },
            text: "- item\n".into(),
        },
        PatchEdit::Anchor {
            anchor: Anchor { find: "DOES NOT EXIST".into(), occurrence: 1, position: PatchPosition::After },
            text: "- other\n".into(),
        },
    ], None).unwrap_err();
    assert!(matches!(err, AsterError::AnchorNotFound(_)));
    assert_eq!(fs::read_to_string(&path).unwrap(), original, "file must be unchanged");
}
