use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use crate::error::{AsterError, AsterResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub id: String,
    pub description: String,
    pub params_schema: Value,
    pub returns_schema: Value,
    pub headless: bool,
    pub source: String,
}

type Handler = Box<dyn Fn(Value) -> AsterResult<Value> + Send + Sync>;

pub struct CommandRegistry {
    specs: HashMap<String, CommandSpec>,
    handlers: HashMap<String, Handler>,
}

impl CommandRegistry {
    pub fn new() -> Self {
        Self {
            specs: HashMap::new(),
            handlers: HashMap::new(),
        }
    }

    /// Register a spec-only command (no handler; dispatching returns E_NEEDS_GUI).
    pub fn register(&mut self, spec: CommandSpec) {
        self.specs.insert(spec.id.clone(), spec);
    }

    /// Register a command with a headless handler.
    pub fn register_with_handler(
        &mut self,
        spec: CommandSpec,
        handler: impl Fn(Value) -> AsterResult<Value> + Send + Sync + 'static,
    ) {
        self.specs.insert(spec.id.clone(), spec.clone());
        self.handlers.insert(spec.id, Box::new(handler));
    }

    /// Return all specs, sorted by id.
    pub fn list(&self) -> Vec<&CommandSpec> {
        let mut v: Vec<_> = self.specs.values().collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    }

    pub fn get(&self, id: &str) -> Option<&CommandSpec> {
        self.specs.get(id)
    }

    /// Dispatch a command by id.
    /// - Unknown id → E_NOT_FOUND
    /// - Known but no handler → E_NEEDS_GUI
    /// - Known with handler → handler result
    pub fn dispatch(&mut self, id: &str, params: Value) -> AsterResult<Value> {
        if let Some(handler) = self.handlers.get(id) {
            handler(params)
        } else if self.specs.contains_key(id) {
            Err(AsterError::NeedsGui {
                hint: "Start the Aster GUI: run `aster` without arguments".into(),
            })
        } else {
            Err(AsterError::NotFound(format!("command not found: {id}")))
        }
    }
}
