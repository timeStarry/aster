pub mod doc;
pub mod workspace;
pub mod export;
pub mod plugin;

use std::sync::{Arc, Mutex};
use crate::{
    document::DocumentService,
    workspace::WorkspaceService,
    plugin::PluginHost,
    registry::CommandRegistry,
};

pub fn register_core_commands(
    registry: &mut CommandRegistry,
    doc: Arc<DocumentService>,
    ws: Arc<WorkspaceService>,
    host: Arc<Mutex<PluginHost>>,
) {
    doc::register(registry, Arc::clone(&doc));
    workspace::register(registry, Arc::clone(&ws));
    export::register(registry, Arc::clone(&doc));
    plugin::register(registry, Arc::clone(&host));
}
