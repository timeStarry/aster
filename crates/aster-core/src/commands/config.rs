use serde_json::{json, Value};
use crate::{
    config::Config,
    error::AsterError,
    registry::{CommandRegistry, CommandSpec},
};

pub fn register(registry: &mut CommandRegistry) {
    registry.register_with_handler(
        CommandSpec {
            id: "config.get".into(),
            description: "Read the unified application configuration (~/.aster/config.json)".into(),
            params_schema: json!({"type": "object"}),
            returns_schema: json!({"type": "object"}),
            headless: true,
            source: "core".into(),
        },
        move |_params| {
            let exists = Config::exists_on_disk();
            let cfg = Config::load()?;
            let mut val = serde_json::to_value(&cfg)
                .map_err(|e| AsterError::Io(e.to_string()))?;
            if let Some(obj) = val.as_object_mut() {
                obj.insert("existsOnDisk".into(), Value::Bool(exists));
            }
            Ok(val)
        },
    );

    registry.register_with_handler(
        CommandSpec {
            id: "config.set".into(),
            description: "Merge and persist fields into ~/.aster/config.json".into(),
            params_schema: json!({"type": "object"}),
            returns_schema: json!({"type": "object"}),
            headless: true,
            source: "core".into(),
        },
        move |params| {
            let current = Config::load().unwrap_or_default();
            let mut merged = serde_json::to_value(&current)
                .map_err(|e| AsterError::Io(e.to_string()))?;
            if let (Some(dst), Some(src)) = (merged.as_object_mut(), params.as_object()) {
                for (k, v) in src {
                    if k != "existsOnDisk" {
                        dst.insert(k.clone(), v.clone());
                    }
                }
            }
            let updated: Config = serde_json::from_value(merged)
                .map_err(|e| AsterError::InvalidParams(format!("invalid config: {e}")))?;
            updated.save()?;
            serde_json::to_value(&updated)
                .map_err(|e| AsterError::Io(e.to_string()))
        },
    );
}
