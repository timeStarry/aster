wit_bindgen::generate!({
    world: "plugin",
    path: "../../wit/aster-plugin.wit",
});

use exports::aster::plugin::guest::Guest;
use std::cell::RefCell;

struct LibraryPlugin;

// Simple in-memory index: list of (path, title, body)
thread_local! {
    static INDEX: RefCell<Vec<(String, String, String)>> = RefCell::new(Vec::new());
}

impl Guest for LibraryPlugin {
    fn activate(_settings_json: String) -> Result<(), String> {
        Ok(())
    }

    fn invoke(command_id: String, params_json: String) -> Result<String, String> {
        let params: serde_json::Value = serde_json::from_str(&params_json)
            .map_err(|e| format!("invalid params: {e}"))?;
        match command_id.as_str() {
            "library.index" => {
                let _path = params["path"].as_str().ok_or("missing path")?;
                // In M4: index is reset; real file-walking comes via host read_file calls
                INDEX.with(|idx| idx.borrow_mut().clear());
                Ok(serde_json::json!({"indexed": 0}).to_string())
            }
            "library.search" => {
                let query = params["query"].as_str().ok_or("missing query")?;
                let limit = params["limit"].as_u64().unwrap_or(10) as usize;
                let results: Vec<serde_json::Value> = INDEX.with(|idx| {
                    idx.borrow().iter()
                        .filter(|(_, title, body)| {
                            title.to_lowercase().contains(&query.to_lowercase()) ||
                            body.to_lowercase().contains(&query.to_lowercase())
                        })
                        .take(limit)
                        .map(|(path, title, _body)| serde_json::json!({
                            "path": path,
                            "title": title,
                            "snippet": format!("…matches '{query}'…")
                        }))
                        .collect()
                });
                Ok(serde_json::json!(results).to_string())
            }
            _ => Err(format!("unknown command: {command_id}")),
        }
    }

    fn transform(_hook: String, _path: String, content: Vec<u8>) -> Result<Vec<u8>, String> {
        Ok(content)
    }
}

export!(LibraryPlugin);
