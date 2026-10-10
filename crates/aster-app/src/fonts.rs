use fontdb::Language;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// One installed font family, as offered in the font pickers.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FontFamily {
    /// Name to use in CSS `font-family` (the font's English/default name).
    pub family: String,
    /// Chinese name, when the font provides one (e.g. 苹方-简 for PingFang SC).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub localized: Option<String>,
    /// True when the font is fixed-pitch (suitable for code).
    pub mono: bool,
}

// Simplified Chinese names first, then Traditional.
const ZH: [Language; 5] = [
    Language::Chinese_PeoplesRepublicOfChina,
    Language::Chinese_Singapore,
    Language::Chinese_Taiwan,
    Language::Chinese_HongKongSAR,
    Language::Chinese_MacaoSAR,
];

/// Scan system fonts. Faces are grouped by family; a family counts as
/// monospaced if any of its faces is fixed-pitch.
pub fn scan() -> Vec<FontFamily> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    let mut by_key: BTreeMap<String, FontFamily> = BTreeMap::new();
    for face in db.faces() {
        // The first entry is the default (usually English) family name.
        let Some((name, _)) = face.families.first() else { continue };
        let name = name.trim();
        // Hidden system families (".SF NS", ".AppleSystemUIFont") cannot be
        // selected by name in CSS.
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let zh = ZH.iter().find_map(|lang| {
            face.families
                .iter()
                .find(|(n, l)| l == lang && n.trim() != name)
                .map(|(n, _)| n.trim().to_string())
        });
        let entry = by_key.entry(name.to_lowercase()).or_insert_with(|| FontFamily {
            family: name.to_string(),
            localized: None,
            mono: false,
        });
        entry.mono |= face.monospaced;
        if entry.localized.is_none() {
            entry.localized = zh;
        }
    }
    by_key.into_values().collect()
}

static CACHE: OnceLock<Vec<FontFamily>> = OnceLock::new();

/// List installed font families. Scanning takes a few hundred milliseconds on
/// a typical system, so it runs off the main thread once and is cached.
#[tauri::command]
pub async fn fonts_list() -> Vec<FontFamily> {
    if let Some(v) = CACHE.get() {
        return v.clone();
    }
    let fonts = tauri::async_runtime::spawn_blocking(scan).await.unwrap_or_default();
    CACHE.get_or_init(|| fonts).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_skips_hidden_families_and_dedupes() {
        let fonts = scan();
        assert!(fonts.iter().all(|f| !f.family.starts_with('.')));
        let mut keys: Vec<_> = fonts.iter().map(|f| f.family.to_lowercase()).collect();
        let n = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), n, "families are unique");
        // Sorted case-insensitively for the picker.
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finds_a_monospaced_system_font_on_macos() {
        let fonts = scan();
        let menlo = fonts.iter().find(|f| f.family == "Menlo").expect("Menlo ships with macOS");
        assert!(menlo.mono);
        let helvetica = fonts.iter().find(|f| f.family == "Helvetica").expect("Helvetica ships with macOS");
        assert!(!helvetica.mono);
    }
}
