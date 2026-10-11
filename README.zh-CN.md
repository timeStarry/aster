<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/export/readme/mark-256.png">
  <img src="assets/brand/export/readme/mark-256.png" alt="Aster" width="96">
</picture>

# Aster

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

Aster 是一个跨平台 Markdown 编辑器，面向写作者和 AI 智能体：桌面端实时预览，核心命令同时可供命令行、本地 JSON-RPC（Unix 套接字或 Windows 命名管道）和 MCP 服务器调用。

## 设计思路

- **核心、界面、插件分离。** 核心是 Rust 实现的命令注册表，管文档、工作区和插件。GUI、CLI、MCP 是同一组命令的三个入口。插件分两层：前端 JS 管渲染和主题，后端 WASM 管加密、索引等逻辑。
- **实时预览，隐藏标记。** 实时预览把文档渲染出来，光标离开一行就隐藏该行的标记。加粗、代码、链接、图片、引用、列表、任务、公式、图表都按渲染后的样子读，光标回到该行又变回源码。
- **完全本地。** 文档和设置都在本地磁盘，不会上传。中英文界面。提供 macOS（Apple Silicon）、Linux（x86_64）和 Windows（x64）版本。
- **默认安全。** 插件按 Ed25519 签名校验：被篡改的插件直接拒绝，未签名的会被标记出来。崩溃时未保存的内容不会丢，磁盘上已被改动的文件不会在未询问时被覆盖。

## 两个版本

| | Lite | Full |
|---|---|---|
| 核心编辑器（实时预览、标签页、搜索） | ✓ | ✓ |
| 数学公式、Mermaid、PDF 导出、额外主题 | — | ✓ |
| 加密与文档库插件 | — | ✓ |

从 [Releases](https://github.com/timeStarry/aster/releases) 下载最新版。

Windows 可使用 Lite 或 Full 的 `.exe` 安装器，也提供供管理员安装的 `.msi` 包。原生菜单栏默认隐藏，可在「设置 → 外观 → 显示菜单栏」开启。

macOS 上目前未做公证；复制到「应用程序」后，先运行一次 `xattr -cr /Applications/Aster.app`。

## 使用

以下快捷键在 macOS 上用 ⌘，在 Windows/Linux 上用 Ctrl。

- **模式**：实时预览和源码；锁可以把它变成只读。`⌘/` 切换。
- **标签页**：`⌘N` 新建，`⌘W` 关闭，`Ctrl+Tab` 切换；把文件拖到窗口上即可打开。
- **格式**：`⌘B` 加粗、`⌘I` 斜体、`⌘K` 链接、`⌘1`–`⌘6` 标题；回车自动续写列表，空项回车结束列表；`Tab` / `Shift+Tab` 缩进并重编号。
- **导航**：右侧导航条用短横线表示标题，悬停查看，点击跳转。
- **设置**：`⌘,` — 语言、主题、字体、版式、行为、插件、快捷键、备份。

## 面向智能体

GUI 用的每条命令，CLI 和 MCP 服务器也能用。

```bash
aster read note.md                    # → {"content": "…", "hash": "…"}
aster outline note.md                 # 标题大纲，JSON
aster run doc.patch --json '{…}'      # 按 id 调用任意命令
aster mcp                             # 在 stdio 上启动 MCP 服务器
```

GUI 运行中，`editor.*` 命令会通过本地连接转发给它；否则返回 `E_NEEDS_GUI`。

## 开发

需要 Rust（stable）、Node.js 22、pnpm 10；后端插件还要 wasm32-wasip2 目标。

```bash
pnpm install
pnpm -F @aster/ui dev     # 前端开发服务器
pnpm -r test              # 全部测试
cargo test --workspace    # 核心、应用、CLI、插件
```

桌面应用（需先 `cargo install tauri-cli --version '^2'`）：

```bash
(cd crates/aster-app && cargo tauri dev)               # lite

node scripts/stage-plugins.mjs                          # full：先准备插件
(cd crates/aster-app && cargo tauri dev --features bundled-plugins --config tauri.full.conf.json)
```

推送 `v*` 标签会运行 Release 工作流，构建 macOS、Linux 和 Windows 的 Lite / Full 包。Windows 同时产出 NSIS `.exe` 与 WiX `.msi` 安装器。选定构建全部成功后才创建草稿 Release；已有 Release 及其资产会保留。

打新版本标签前，同步更新各 crate 的版本、`tauri.conf.json` 中的应用版本，以及用于 MSI 升级的数字版本 `bundle.windows.wix.version`。

只验证 Windows 构建而不发布时，手动运行 Release 工作流，使用 `platforms=windows`、`publish=false`：

```bash
gh workflow run release.yml --ref main -f platforms=windows -F publish=false
```

本地构建：macOS 在 `crates/aster-app` 运行 `cargo tauri build`，Linux 用 `docker/build-linux.sh`。Windows 先安装 Visual Studio C++ Build Tools 与 Tauri 所需组件，再从仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
rustup target add x86_64-pc-windows-msvc wasm32-wasip2
node scripts/stage-plugins.mjs
Set-Location crates/aster-app
cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis,msi --features bundled-plugins --config tauri.full.conf.json
# Lite：省略 --features bundled-plugins 和 --config tauri.full.conf.json。
```

### 目录

```
crates/aster-core    核心：命令注册表、文档、工作区、插件、签名校验
crates/aster-app     Tauri 桌面应用
crates/aster-cli     命令行（同一组命令）
crates/aster-rpc     JSON-RPC 套接字与 MCP 服务器
packages/editor      CodeMirror：实时预览、格式、表格、大纲
packages/ui          应用外壳：标签页、设置、恢复、中英文
plugins/             前端插件（数学、Mermaid、PDF、主题）
plugins-wasm/        WASM 后端插件（加密、文档库）
assets/brand         图标与品牌源文件（用 tools/export_brand_icons.py 重新生成）
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
