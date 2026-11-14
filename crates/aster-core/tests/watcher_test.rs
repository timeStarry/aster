use aster_core::document::DocumentService;
use aster_core::watcher::{DocumentWatcher, FileChangeEvent};
use std::sync::mpsc;
use std::time::Duration;
use tempfile::TempDir;

#[test]
fn watcher_dedupes_self_writes_and_emits_external_changes() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("live.md");
    let svc = DocumentService::new();
    let initial_hash = svc.write(&path, "# v1\n", None).unwrap();

    let (tx, rx) = mpsc::channel::<FileChangeEvent>();
    let watcher = DocumentWatcher::new(move |evt| {
        let _ = tx.send(evt);
    });
    watcher.watch(&path, &initial_hash);

    // 1. Self-write: record_self_write before/with disk write -> must NOT emit
    let self_hash = svc.write(&path, "# v2 (self)\n", Some(&initial_hash)).unwrap();
    watcher.record_self_write(&path, &self_hash);
    watcher.notify_external_write(&path);
    assert!(
        rx.recv_timeout(Duration::from_millis(250)).is_err(),
        "self-write with matching hash must be ignored"
    );

    // 2. External write (e.g. Git / Agent): hash differs -> emits once
    let ext_hash = svc.write(&path, "# v3 (external)\n", None).unwrap();
    // Either OS notify or explicit notify_external_write delivers it; deduplicated to 1 event
    watcher.notify_external_write(&path);
    let evt = rx
        .recv_timeout(Duration::from_secs(2))
        .expect("external modification must trigger FileChangeEvent");
    assert_eq!(evt.content, "# v3 (external)\n");
    assert_eq!(evt.hash, ext_hash);
    assert!(
        rx.recv_timeout(Duration::from_millis(250)).is_err(),
        "duplicate FS notifications for the same hash must be suppressed"
    );

    // 3. Unwatch stops notifications
    watcher.unwatch(&path);
    svc.write(&path, "# v4 (after close)\n", None).unwrap();
    watcher.notify_external_write(&path);
    assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
}
