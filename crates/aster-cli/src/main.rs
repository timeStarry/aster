mod commands;

use clap::{Parser, Subcommand};
use anyhow::Result;

#[derive(Parser)]
#[command(name = "aster", about = "Aster Markdown editor CLI")]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub command: Cmd,
}

#[derive(Subcommand)]
pub(crate) enum Cmd {
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
}

#[derive(Subcommand)]
pub(crate) enum WorkspaceCmd {
    /// List Markdown files in a directory
    List {
        #[arg(long)]
        root: String,
    },
}

#[derive(Subcommand)]
pub(crate) enum ExportCmd {
    /// Export Markdown to HTML
    Html {
        path: String,
        #[arg(long)]
        output: Option<String>,
    },
}

#[derive(Subcommand)]
pub(crate) enum PluginCmd {
    /// List installed plugins (M3)
    List,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    commands::dispatch(cli.command)
}
