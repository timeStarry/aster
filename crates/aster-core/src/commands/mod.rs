pub mod doc;
pub mod workspace;
pub mod export;

use std::sync::Arc;
use crate::{
    document::DocumentService,
    workspace::WorkspaceService,
    registry::CommandRegistry,
};

pub fn register_core_commands(
    registry: &mut CommandRegistry,
    doc: Arc<DocumentService>,
    ws: Arc<WorkspaceService>,
) {
    doc::register(registry, Arc::clone(&doc));
    workspace::register(registry, Arc::clone(&ws));
    export::register(registry, Arc::clone(&doc));
}
