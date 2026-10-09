use std::sync::{Arc, Mutex};
use serde_json::{json, Value};
use crate::{
    plugin::PluginHost,
    registry::{CommandRegistry, CommandSpec},
    error::{AsterError, AsterResult},
};

pub fn register(registry: &mut CommandRegistry, host: Arc<Mutex<PluginHost>>) {
    // plugin.list
    {
        let h = Arc::clone(&host);
        registry.register_with_handler(
            CommandSpec {
                id: "plugin.list".into(),
                description: "List installed plugins".into(),
                params_schema: json!({"type":"object"}),
                returns_schema: json!({"type":"array"}),
                headless: true,
                source: "core".into(),
            },
            move |_params| {
                let host = h.lock().map_err(|_| AsterError::Io("plugin host lock poisoned".into()))?;
                let list: Vec<Value> = host.list().iter()
                    .map(|p| serde_json::to_value(p).unwrap_or(json!({})))
                    .collect();
                Ok(json!(list))
            },
        );
    }

    // plugin.describe
    {
        let h = Arc::clone(&host);
        registry.register_with_handler(
            CommandSpec {
                id: "plugin.describe".into(),
                description: "Return full manifest info of a plugin by id".into(),
                params_schema: json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
                returns_schema: json!({"type":"object"}),
                headless: true,
                source: "core".into(),
            },
            move |params| {
                let id = params.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| AsterError::InvalidParams("missing field: id".into()))?;
                let host = h.lock().map_err(|_| AsterError::Io("plugin host lock poisoned".into()))?;
                let info = host.get(id)
                    .ok_or_else(|| AsterError::NotFound(format!("plugin not found: {id}")))?;
                Ok(serde_json::to_value(info).unwrap_or(json!({})))
            },
        );
    }

    // plugin.install — local path only in M3
    {
        let h = Arc::clone(&host);
        registry.register_with_handler(
            CommandSpec {
                id: "plugin.install".into(),
                description: "Install a plugin from a local directory path".into(),
                params_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
                returns_schema: json!({"type":"object","properties":{"id":{"type":"string"}}}),
                headless: true,
                source: "core".into(),
            },
            move |params| {
                let src = params.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| AsterError::InvalidParams("missing field: path".into()))?;
                let src_canon = std::path::Path::new(src).canonicalize()
                    .map_err(|e| AsterError::NotFound(format!("plugin path not found: {e}")))?;
                let manifest_path = src_canon.join("aster.plugin.json");
                if !manifest_path.exists() {
                    return Err(AsterError::NotFound("aster.plugin.json not found in plugin directory".into()));
                }
                let user_dir = dirs::home_dir()
                    .unwrap_or_else(|| std::path::PathBuf::from("."))
                    .join(".aster/plugins");
                std::fs::create_dir_all(&user_dir).map_err(|e| AsterError::Io(e.to_string()))?;
                let raw = std::fs::read(&manifest_path).map_err(|e| AsterError::Io(e.to_string()))?;
                let id_val: serde_json::Value = serde_json::from_slice(&raw)
                    .map_err(|e| AsterError::InvalidParams(format!("invalid manifest: {e}")))?;
                let id = id_val.get("id").and_then(|v| v.as_str())
                    .ok_or_else(|| AsterError::InvalidParams("manifest missing id".into()))?
                    .to_owned();
                let dest = user_dir.join(&id);
                if dest.exists() {
                    std::fs::remove_dir_all(&dest).map_err(|e| AsterError::Io(e.to_string()))?;
                }
                copy_dir(&src_canon, &dest).map_err(|e| AsterError::Io(e.to_string()))?;
                let mut host = h.lock().map_err(|_| AsterError::Io("lock poisoned".into()))?;
                host.load_dir(&user_dir, crate::plugin::PluginSource::User)?;
                Ok(json!({"id": id}))
            },
        );
    }
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        // Use lstat (file_type on DirEntry) so we see symlinks, not their targets.
        let ty = entry.file_type()?;
        if ty.is_symlink() {
            // Refuse symlinks — a crafted plugin could point outside the plugin dir.
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("plugin contains a symlink: {:?}", entry.file_name()),
            ));
        }
        if ty.is_dir() {
            copy_dir(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}
