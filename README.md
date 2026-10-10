<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/export/readme/mark-256.png">
  <img src="assets/brand/export/readme/mark-256.png" alt="Aster" width="96">
</picture>

# Aster

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

Aster is a cross-platform Markdown editor for people and agents: a desktop app with a focused live preview, and a headless core that other programs can drive through a JSON-RPC socket or as an MCP server for AI agents.

## Design

- **Core, interface, plugins.** The core is Rust: a small command registry that owns document and workspace operations. The Tauri GUI, the CLI, and the MCP server are three faces of the same commands. Plugins extend it in two layers — JavaScript in the webview for rendering and themes, WebAssembly components for backend logic.
- **Live preview that hides markup.** Live preview renders the document and hides markdown syntax; source is revealed under the cursor so it stays editable. Everything else — bold, code, links, images, quotes, lists, tasks, math, diagrams — reads as rendered.
- **Local and offline.** Documents and settings stay on your disk; nothing is uploaded. Chinese and English interface. Builds are published for macOS (Apple Silicon) and Linux (x86_64); Windows is a target but not yet released.
- **Safe by default.** Plugins are checked against an Ed25519 signature: tampered plugins are refused, unsigned ones are marked as such. Unsaved work survives a crash, and a file changed on disk is never overwritten without asking.

## Two editions

| | Lite | Full |
|---|---|---|
| Core editor (live preview, tabs, search) | ✓ | ✓ |
| Math (KaTeX), Mermaid, PDF export, extra theme | — | ✓ |
| Encryption and document library plugins | — | ✓ |

Download the latest from [Releases](https://github.com/timeStarry/aster/releases).

On macOS the app is not yet notarized; after copying it to Applications, run `xattr -cr /Applications/Aster.app` once.

## Using Aster

Shortcuts below use ⌘ on macOS and Ctrl on Windows/Linux.

- **Modes.** Live preview and source; a lock makes either read-only. `⌘/` toggles.
- **Tabs.** `⌘N` new, `⌘W` close, `Ctrl+Tab` cycles; drag a file onto the window to open it.
- **Formatting.** `⌘B` bold, `⌘I` italic, `⌘K` link, `⌘1`–`⌘6` headings; lists continue on Enter, empty item ends the list; `Tab` / `Shift+Tab` indent and renumber.
- **Navigation.** The right rail shows headings as dashes; hover to read, click to jump.
- **Settings.** `⌘,` — language, theme, fonts, layout, behavior, plugins, shortcuts, backup.

## For agents

Every command the GUI uses is also on the CLI and the MCP server.

```bash
aster read note.md                    # → {"content": "…", "hash": "…"}
aster outline note.md                 # heading outline as JSON
aster run doc.patch --json '{…}'      # dispatch any command by id
aster mcp                             # MCP server on stdio
```

With the GUI running, `editor.*` commands are forwarded to it over the socket; headless they return `E_NEEDS_GUI`.

## Developing

Requires Rust (stable), Node.js 22, pnpm 10, and the wasm32-wasip2 target for backend plugins.

```bash
pnpm install
pnpm -F @aster/ui dev     # frontend dev server
pnpm -r test              # all tests
cargo test --workspace    # core, app, cli, plugins
```

Desktop app (needs `cargo install tauri-cli --version '^2'`):

```bash
(cd crates/aster-app && cargo tauri dev)               # lite

bash scripts/stage-plugins.sh                           # full: stage plugins first
(cd crates/aster-app && cargo tauri dev --features bundled-plugins --config tauri.full.conf.json)
```

Release builds are made locally: `cargo tauri build` in `crates/aster-app` for macOS, `docker/build-linux.sh` for Linux.

### Project layout

```
crates/aster-core    core: registry, documents, workspace, plugins, signatures
crates/aster-app     Tauri desktop app
crates/aster-cli     command-line interface (same commands)
crates/aster-rpc     JSON-RPC socket + MCP server
packages/editor      CodeMirror: live preview, formatting, tables, outline
packages/ui          app shell: tabs, settings, recovery, i18n
plugins/             frontend plugins (math, Mermaid, PDF, themes)
plugins-wasm/        WASM backend plugins (encryption, document library)
assets/brand         icons and brand sources (regenerate with tools/export_brand_icons.py)
```

## License

MIT. See [LICENSE](LICENSE).
