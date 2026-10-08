use thiserror::Error;

#[derive(Debug, Error, serde::Serialize)]
#[serde(tag = "code", content = "data")]
pub enum AsterError {
    #[error("command requires GUI: {hint}")]
    NeedsGui { hint: String },

    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("conflict: expected hash {expected}, got {actual}")]
    Conflict { expected: String, actual: String },

    #[error("not found: {0}")]
    NotFound(String),

    #[error("anchor not found: {0}")]
    AnchorNotFound(String),

    #[error("invalid params: {0}")]
    InvalidParams(String),

    #[error("plugin failed: {0}")]
    PluginFailed(String),

    #[error("IO error: {0}")]
    Io(String),
}

impl AsterError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NeedsGui { .. }       => "E_NEEDS_GUI",
            Self::PermissionDenied(_)   => "E_PERMISSION_DENIED",
            Self::Conflict { .. }       => "E_CONFLICT",
            Self::NotFound(_)           => "E_NOT_FOUND",
            Self::AnchorNotFound(_)     => "E_ANCHOR_NOT_FOUND",
            Self::InvalidParams(_)      => "E_INVALID_PARAMS",
            Self::PluginFailed(_)       => "E_PLUGIN_FAILED",
            Self::Io(_)                 => "E_IO",
        }
    }
}

impl From<std::io::Error> for AsterError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

pub type AsterResult<T> = Result<T, AsterError>;
