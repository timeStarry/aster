mod commands;
mod mcp;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "aster",
    about = "Aster Markdown editor CLI — pass a file (`aster notes.md`) to open in Aster, or run a subcommand",
    args_conflicts_with_subcommands = true
)]
pub(crate) struct Cli {
    /// Open a Markdown file directly in the Aster GUI (`aster notes.md`)
    #[arg(value_name = "FILE")]
    pub file: Option<String>,

    #[command(subcommand)]
    pub command: Option<Cmd>,
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub(crate) enum Cmd {
    /// Open a Markdown file in the Aster GUI
    Open { path: String },
    /// Read a Markdown file and print JSON {content, hash}
    Read { path: String },
    /// Write content to a Markdown file (reads stdin)
    Write {
        path: String,
        #[arg(long)]
        expected_hash: Option<String>,
    },
    /// Print heading outline as JSON
    Outline { path: String },
    /// Dispatch any registered command by id
    Run {
        id: String,
        #[arg(long, default_value = "{}")]
        json: String,
    },
    /// Workspace operations
    #[command(subcommand)]
    Workspace(WorkspaceCmd),
    /// Export operations
    #[command(subcommand)]
    Export(ExportCmd),
    /// Plugin operations
    #[command(subcommand)]
    Plugin(PluginCmd),
    /// Start an MCP stdio server (for AI agents)
    Mcp,
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub(crate) enum WorkspaceCmd {
    /// List Markdown files in a directory
    List {
        #[arg(long)]
        root: String,
    },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub(crate) enum ExportCmd {
    /// Export Markdown to HTML
    Html {
        path: String,
        #[arg(long)]
        output: Option<String>,
    },
}

#[derive(Subcommand, Debug, PartialEq, Eq)]
pub(crate) enum PluginCmd {
    /// List installed plugins
    List,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match (cli.command, cli.file) {
        (Some(cmd), _) => commands::dispatch(cmd),
        (None, Some(path)) => commands::dispatch(Cmd::Open { path }),
        (None, None) => commands::launch_gui(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_shorthand_file_and_subcommands() {
        let shorthand = Cli::try_parse_from(["aster", "README.md"]).unwrap();
        assert_eq!(shorthand.file.as_deref(), Some("README.md"));
        assert!(shorthand.command.is_none());

        let explicit = Cli::try_parse_from(["aster", "open", "docs/guide.md"]).unwrap();
        assert_eq!(
            explicit.command,
            Some(Cmd::Open {
                path: "docs/guide.md".into()
            })
        );

        let read = Cli::try_parse_from(["aster", "read", "notes.md"]).unwrap();
        assert_eq!(
            read.command,
            Some(Cmd::Read {
                path: "notes.md".into()
            })
        );
    }
}
