<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/export/readme/mark-256.png">
  <img src="assets/brand/export/readme/mark-256.png" alt="Aster" width="96">
</picture>

# Aster

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

Aster is a cross-platform Markdown editor for people and agents: a desktop app with a focused live preview, and a headless core that other programs can drive through local JSON-RPC (Unix sockets or Windows named pipes) or as an MCP server for AI agents.

## Design

- **Core, interface, plugins.** The core is Rust: a small command registry that owns document and workspace operations. The Tauri GUI, the CLI, and the MCP server are three faces of the same commands. Plugins extend it in two layers — JavaScript in the webview for rendering and themes, WebAssembly components for backend logic.
- **Live preview that hides markup.** Live preview renders the document and hides markdown syntax; source is revealed under the cursor so it stays editable. Everything else — bold, code, links, images, quotes, lists, tasks, math, diagrams — reads as rendered.
- **Local and offline.** Documents and settings stay on your disk; nothing is uploaded. Chinese and English interface. Builds are published for macOS (Apple Silicon), Linux (x86_64), and Windows (x64).
- **Platform appearance.** macOS uses Liquid Glass on macOS 26 and newer, with Vibrancy on older versions. Windows uses Fluent styling over Mica, with Acrylic or an opaque background as fallbacks. Both share the same editor and core; document content stays on an opaque reading surface. The shell follows the selected light, dark, or plugin theme and respects reduced transparency.
- **Safe by default.** Plugins are checked against an Ed25519 signature: tampered plugins are refused, unsigned ones are marked as such. Unsaved work survives a crash, and a file changed on disk is never overwritten without asking.

## Two editions

| | Lite | Full |
|---|---|---|
| Core editor (live preview, tabs, search) | ✓ | ✓ |
| Math (KaTeX), Mermaid, PDF export, extra theme | — | ✓ |
| Encryption and document library plugins | — | ✓ |

Download the latest from [Releases](https://github.com/timeStarry/aster/releases).

On Windows, use the Lite or Full `.exe` installer. `.msi` packages are also available for administrator installation. The native menu bar is hidden by default; enable it in Settings → Appearance → Show menu bar.

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

With the GUI running, `editor.*` commands are forwarded to it over the local connection; headless they return `E_NEEDS_GUI`.

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

node scripts/stage-plugins.mjs                          # full: stage plugins first
(cd crates/aster-app && cargo tauri dev --features bundled-plugins --config tauri.full.conf.json)
```

Pushing a `v*` tag runs the Release workflow for Lite and Full on macOS, Linux, and Windows. Windows produces both NSIS `.exe` and WiX `.msi` installers. All selected builds must succeed before the workflow creates a draft release; it preserves existing releases and their assets.

Before tagging a new version, update the crate versions, the application version in `tauri.conf.json`, and its numeric `bundle.windows.wix.version` for MSI upgrades.

For a Windows build without publishing, run the Release workflow manually with `platforms=windows` and `publish=false`:

```bash
gh workflow run release.yml --ref main -f platforms=windows -F publish=false
```

Local macOS builds use `cargo tauri build` in `crates/aster-app`; Linux builds use `docker/build-linux.sh`. On Windows, install Visual Studio C++ Build Tools and the Tauri prerequisites, then run from the repository root:

```powershell
pnpm install --frozen-lockfile
rustup target add x86_64-pc-windows-msvc wasm32-wasip2
node scripts/stage-plugins.mjs
Set-Location crates/aster-app
cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis,msi --features bundled-plugins --config tauri.full.conf.json
# Lite: omit --features bundled-plugins and --config tauri.full.conf.json.
```

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
