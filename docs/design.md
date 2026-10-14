# Aster 设计文档

- 日期：2026-10-08
- 状态：M1–M4 已实现；本文记录设计依据，实现细节以代码为准
- 覆盖范围：M1、M2 完整设计；M3 插件 API 与 manifest 契约；M4 仅接口草案

## 1. 目标与定位

Aster 是一个跨平台桌面 Markdown 编辑器。

- **本体轻量、高性能**：安装包小、启动快、内存占用低；不装任何插件也能提供优于系统记事本的编辑与阅览体验。
- **实时渲染、沉浸式**：源码 + 行内实时装饰为默认编辑模式，另有纯源码与只读阅览模式。
- **AI native**：本体提供 Agent 可直接调用的原生接口（CLI、MCP、本地 JSON-RPC）；所有能力（含插件能力）以机器可读的方式声明，Agent 可自行发现并调用。
- **一切皆插件**：文档库、S3、加密、主题、Mermaid、PDF 导出等扩展能力均通过插件提供；官方插件与第三方插件走同一机制，无私有 API。

### 1.1 非目标（当前阶段）

- 移动端与 Web 端（设计语言与接口需可复用，但不在本期实现）
- 插件市场
- 所见即所得（Typora 式）编辑模型
- 本体内置的索引、全文搜索、双链、标签（属于文档库插件）

## 2. 产品形态：Lite 版与完整版

两个版本使用同一份 `aster` 可执行文件，区别仅在于随安装包附带的插件。

| | Lite 版 | 完整版 |
|---|---|---|
| 本体 | 相同 | 相同 |
| 内置插件 | 无 | 官方推荐插件（`bundled-plugins/`） |
| 联网 | 本体从不主动联网 | 同左；插件按各自权限 |
| CLI / MCP | 完整保留 | 完整保留 |

- **插件目录**：
  - 内置目录：安装包资源目录下的 `bundled-plugins/`，只读，随应用升级。
  - 用户目录：`~/.aster/plugins/`。
  - 同 id 插件以用户目录版本优先。内置插件可停用，不可卸载。
- **一键升级为完整版**：设置页按钮与 `aster plugin install-pack aster.official-full` 使用同一插件包机制（见 6.7）。
- **"纯本地"边界**：
  - 本体无遥测。
  - 更新检查默认关闭，或需用户确认。
  - CLI/MCP 仅使用本地 socket。
  - 只有用户主动触发的插件安装会联网。

## 3. 技术选型

| 领域 | 选型 | 理由 |
|---|---|---|
| 应用外壳 | Tauri 2 | 使用系统 WebView，包体小 |
| 内核 | Rust | 性能、跨平台一致性、可脱离 UI 运行 |
| 前端框架 | SolidJS | 体积小，无虚拟 DOM 开销 |
| 编辑器 | CodeMirror 6 | 纯文本模型、装饰系统成熟、大文档性能好 |
| 渲染 | markdown-it + 插件化渲染管线 | 阅览模式与导出共用 |
| WASM 运行时（M4） | wasmtime + Component Model（WIT） | 强隔离，宿主函数可按权限授予 |
| 外部接口 | JSON-RPC 2.0 over Unix socket / Windows named pipe；MCP | Agent 生态原生接入 |

桌面界面共用 SolidJS 外壳和 CodeMirror 编辑器，按平台应用外观：macOS 使用 Liquid Glass，Windows 使用 Fluent。原生材质由 `aster-app` 管理，平台样式由 `packages/ui` 管理；文档、设置、插件和编辑器状态保持共享。

- **macOS**：macOS 26 及以上使用原生玻璃视图，旧版回退到 Vibrancy；材质不可用时使用实色背景。
- **Windows**：优先使用 Mica，失败时尝试 Acrylic，再回退到实色背景。保留原生标题栏和窗口控制。
- **阅读与主题**：玻璃材质用于标签栏、状态栏和设置导航，正文与设置内容保持实色。明暗主题及主题插件的 `color-scheme` 同步到原生窗口；减少透明度和高对比度模式使用实色外观。

## 4. 整体架构

```
┌──────────────────────── 入口层 ────────────────────────┐
│  aster (GUI)      aster <cmd> (CLI)      aster mcp     │
│  Tauri 2 窗口      人/脚本                 Agent        │
└───────┬──────────────────┬──────────────────┬──────────┘
        │                  │ 优先连接运行中的 GUI         │
        │                  └──── JSON-RPC (本地 socket) ─┤
        │                        GUI 不在时 → headless   │
┌───────▼──────────────── aster-core (Rust 库) ──────────▼┐
│  命令注册表   文档服务   工作区   插件宿主   权限   配置       │
└─────────────────────────────────────────────────────────┘
        ▲ Tauri IPC
┌───────┴──── 前端 (WebView) ────┐
│  CodeMirror 6 编辑器 + 装饰层   │
│  阅览渲染器   命令面板   前端插件 │
└────────────────────────────────┘
```

### 4.1 单一可执行文件

- `aster`：启动 GUI。
- `aster [path]`：在 GUI 中打开文件或文件夹。
- `aster <subcommand>`：以 CLI 方式运行。
- `aster mcp`：以 stdio 方式启动 MCP server。

### 4.2 内核与 UI 解耦

`aster-core` 不依赖任何 UI 代码。GUI、CLI、MCP 都是它的调用方：

- 前端通过 Tauri IPC 调用内核。
- 外部进程通过本地 socket + JSON-RPC 调用内核。

两条路径进入同一个命令分发器。

### 4.3 GUI 连接与 headless 回退

CLI/MCP 启动时，先尝试连接运行中 GUI 的 socket：

- 连接成功：命令转发给 GUI 执行，可操作当前光标、选区、标签。
- 连接失败：在本进程中加载 `aster-core`，以 headless 模式执行。

socket 位置：

- macOS/Linux：`$XDG_RUNTIME_DIR/aster.sock`；无该变量时用 `~/.aster/run/aster.sock`。
- Windows：`\\.\pipe\aster-<username>`。

socket 仅允许当前用户访问：Unix 下权限为 `0600`；Windows 下 pipe 的 ACL 限定为当前用户。

## 5. 命令注册表

命令注册表是系统的核心抽象，也是唯一的真相源。

### 5.1 命令定义

```ts
interface CommandSpec {
  id: string;              // 如 "doc.read"、"mermaid.exportSvg"
  description: string;     // 面向人与 Agent 的说明
  params: JSONSchema;      // 参数 schema
  returns: JSONSchema;     // 返回值 schema
  permissions: string[];   // 执行所需权限
  headless: boolean;       // 能否在无 GUI 时执行
  source: "core" | string; // "core" 或插件 id
}
```

### 5.2 三个入口自动生成

以下内容都从注册表派生，不单独维护：

- GUI 命令面板
- CLI 子命令与 `--help`（`aster run <id> --json '<params>'` 为通用形式；本体命令另有便捷别名，如 `aster read <path>`）
- MCP `tools/list`：命令 id 中的 `.` 映射为 `_`

### 5.3 本体命令

| 命令 | 说明 | headless |
|---|---|---|
| `doc.read` | 读取文档内容与哈希 | ✓ |
| `doc.write` | 整篇写入（可带 `expectedHash`） | ✓ |
| `doc.patch` | 按行范围或文本锚点局部修改（可带 `expectedHash`） | ✓ |
| `doc.outline` | 返回标题树 | ✓ |
| `workspace.open` | 设定工作区根路径 | ✓ |
| `workspace.list` | 列出工作区内 Markdown 文件 | ✓ |
| `editor.openFile` | 在 GUI 中打开文件 | ✗ |
| `editor.getSelection` | 获取当前选区与光标 | ✗ |
| `editor.insert` | 在光标或指定位置插入 | ✗ |
| `plugin.list` | 列出已安装插件 | ✓ |
| `plugin.describe` | 返回插件 manifest | ✓ |
| `plugin.install` | 从本地路径或 URL 安装插件 | ✓ |
| `plugin.installPack` | 安装插件包 | ✓ |
| `export.html` | 导出为 HTML | ✓ |

### 5.4 `doc.patch`

参数：

```json
{
  "path": "notes/a.md",
  "expectedHash": "sha256:…",
  "edits": [
    { "range": { "startLine": 10, "endLine": 12 }, "text": "…" },
    { "anchor": { "find": "## 待办", "occurrence": 1 }, "position": "after", "text": "…" }
  ]
}
```

规则：

- 多个 edits 原子应用：任一 edit 定位失败，则整体不生效，并返回 `E_ANCHOR_NOT_FOUND`。
- `expectedHash` 不匹配时返回 `E_CONFLICT`，`data` 中附带当前哈希。
- GUI 中已打开同一文档时，修改作为一个撤销单元应用到编辑器事务中，用户可用 Cmd/Ctrl+Z 撤回；同时在状态栏短暂提示"由 Agent 修改"。

### 5.5 错误模型

所有命令统一返回 JSON-RPC 错误：`{ code, message, data? }`。

错误码集中定义在 `aster-core`：

| 错误码 | 含义 |
|---|---|
| `E_NEEDS_GUI` | 命令需要 GUI。`data.hint` 给出启动方式 |
| `E_PERMISSION_DENIED` | 缺少权限 |
| `E_CONFLICT` | 乐观锁冲突 |
| `E_NOT_FOUND` | 文件、命令或插件不存在 |
| `E_ANCHOR_NOT_FOUND` | patch 定位失败 |
| `E_INVALID_PARAMS` | 参数未通过 schema 校验 |
| `E_PLUGIN_FAILED` | 插件执行异常 |
| `E_IO` | 文件系统错误 |

## 6. 插件系统

### 6.1 双层模型

| 层 | 语言 / 形态 | 运行位置 | 适用 |
|---|---|---|---|
| 前端层 | JS/TS（ES module） | WebView，受限 API | UI、渲染器、主题、编辑器行为 |
| 后端层（M4） | WASM component | 内核 wasmtime 沙箱 | 文件、网络、加密、重计算 |

一个插件可以只有前端层、只有后端层，或两者都有。两层共用一份 manifest。

### 6.2 包结构

```
my-plugin/
├── aster.plugin.json   # manifest，必需
├── frontend/index.js   # 可选
├── backend/plugin.wasm # 可选
└── README.md
```

### 6.3 Manifest

`packages/plugin-api` 发布 TypeScript 类型，并生成 manifest 的 JSON Schema。安装与加载时，内核都会用这份 schema 校验 manifest。

```json
{
  "id": "aster.mermaid",
  "name": "Mermaid",
  "version": "1.0.0",
  "apiVersion": "1",
  "description": "Render mermaid code blocks in live preview and reading mode",
  "permissions": [],
  "activation": ["onCodeBlock:mermaid"],
  "frontend": "frontend/index.js",
  "backend": null,
  "contributes": {
    "commands": [{
      "id": "mermaid.exportSvg",
      "description": "Export a mermaid block to SVG",
      "params": { "type": "object", "properties": { "path": {"type":"string"}, "blockIndex": {"type":"integer"} }, "required": ["path"] },
      "returns": { "type": "object", "properties": { "svg": {"type":"string"} } },
      "headless": false
    }],
    "renderers": [{ "codeBlock": "mermaid" }],
    "settings": { "type": "object", "properties": { "theme": {"enum":["default","dark","neutral"]} } }
  }
}
```

约束：

- `id` 使用反向域名风格。`aster.*` 前缀保留给官方插件。
- 插件命令 id 必须以插件 id 的最后一段为前缀（如 `mermaid.*`），避免命名冲突。
- `apiVersion` 与本体不兼容时，插件拒绝加载，并给出明确提示。

### 6.4 扩展点

| 扩展点 | 说明 | 层 |
|---|---|---|
| `commands` | 注册到命令注册表，三入口可用 | 前端 / 后端 |
| `renderers` | 代码块与自定义语法渲染（实时预览 + 阅览） | 前端 |
| `editorExtensions` | CodeMirror 扩展：快捷键、装饰、补全 | 前端 |
| `themes` | CSS 变量覆盖，纯声明 | 声明式 |
| `exporters` | 导出格式（PDF、HTML 等） | 前端 / 后端 |
| `storageProviders` | 存储后端（S3、WebDAV、加密存储） | 后端 |
| `hooks` | 生命周期：`onOpen`、`onAfterRead`、`onBeforeSave`、`onSave` | 前端 / 后端 |

内容变换类 hook（`onAfterRead`、`onBeforeSave`）按插件加载顺序串联执行。加密插件即通过这两个 hook 实现。

### 6.5 权限

- 权限在 manifest 中声明，如 `fs:workspace`、`fs:any`、`net:<host-pattern>`、`clipboard`、`shell`。
- 安装时向用户展示所需权限，确认后生效；运行时由内核强制执行。
- 前端插件拿不到 Tauri 原生 API，只能通过注入的 `aster` API 对象访问能力，所有调用都经内核权限校验。
- 前端插件与本体共享同一 WebView，无法按插件区分 CSP，因此 WebView 的 CSP 禁止所有直接外部网络请求。前端插件的网络请求统一经 `aster.net.fetch` 由内核按 `net:<host-pattern>` 校验后代发。
- WASM 宿主函数按权限逐项授予（M4）。
- 安全边界说明：前端插件与本体同处一个 JS 上下文，权限模型能约束其对文件、网络、系统能力的访问，但无法阻止其读取或篡改编辑器内存中的内容。处理敏感数据的能力（加密、凭据、S3）必须放在 WASM 后端层；安装未签名的前端插件时，界面需提示这一风险。

### 6.6 加载与隔离

- 按 `activation` 懒加载：`onStartup`、`onCommand:<id>`、`onCodeBlock:<lang>`、`onFileOpen:<glob>`。未触发的插件零开销。
- 记录每个插件的激活耗时，可通过 `aster plugin stats` 查看。
- 故障隔离：
  - 前端插件：异常被捕获后自动停用该插件，并提示用户。
  - WASM 插件：异常或超时时终止其实例，主进程不受影响。

### 6.7 插件包（Plugin Pack）

插件包是一个 manifest，列出一组插件 id 与版本范围：

```json
{
  "id": "aster.official-full",
  "type": "pack",
  "version": "1.0.0",
  "plugins": [
    { "id": "aster.mermaid", "version": "^1.0.0" },
    { "id": "aster.math", "version": "^1.0.0" }
  ]
}
```

- 安装插件包时，汇总展示所有成员插件的权限，用户一次确认。
- 官方插件分发源提供签名（Ed25519），本体内置官方公钥。签名校验失败时拒绝安装。
- 第三方插件不要求签名，但安装时会明确标注"未签名"。

### 6.8 WASM 接口草案（M4，仅定义）

```wit
package aster:plugin@0.1.0;

interface host {
  read-file: func(path: string) -> result<list<u8>, error>;
  write-file: func(path: string, data: list<u8>) -> result<_, error>;
  http-request: func(req: request) -> result<response, error>;
  log: func(level: level, msg: string);
}

interface guest {
  activate: func(settings: string) -> result<_, error>;
  invoke: func(command-id: string, params-json: string) -> result<string, error>;
  transform: func(hook: string, path: string, content: list<u8>) -> result<list<u8>, error>;
}

world plugin {
  import host;
  export guest;
}
```

宿主函数调用时都会按 manifest 权限校验。该草案在 M4 正式设计前允许调整。

## 7. 零插件本体体验

### 7.1 编辑模式

- **实时预览（默认）**：
  - 光标离开后，就地渲染标题、粗体、斜体、行内代码、删除线、链接、图片、引用、分隔线、任务列表（可点击勾选）；光标所在行显示源码。
  - 表格渲染为网格，光标进入时显示源码；提供"格式化表格"命令对齐列。
  - 代码块按需加载语言包并高亮。无对应渲染器的代码块保持高亮源码显示。
- **纯源码**：仅语法高亮。
- **阅览**：全渲染，只读。

### 7.2 输入辅助

- 括号与强调符号自动配对。
- 列表回车自动续写编号或符号；空项回车退出列表。
- Tab / Shift-Tab 调整缩进。
- 有选中文本时粘贴 URL，自动包为链接。
- 粘贴或拖入图片：保存到文档旁 `assets/`（可配置），并插入相对路径。

### 7.3 阅览排版

- 限制行宽，调整行高。
- 中英文之间自动加间距：仅作用于显示，不修改源文件；可关闭。
- 目录侧栏由标题自动生成，可点击跳转。

### 7.4 沉浸

以下三项可单独开关：

- 专注模式：隐藏所有界面元素。
- 打字机滚动：当前行保持在屏幕中间。
- 段落高亮：当前段落高亮，其余内容变淡。

### 7.5 基础设施

- 多标签、最近文件、会话恢复（恢复标签与光标位置）。
- 自动保存：默认失焦或停止输入 1 秒后保存，可配置。
- 外部修改检测：无未保存修改时自动重新加载；有冲突时提示用户选择版本。
- 查找替换（支持正则）；状态栏显示字数统计。
- 命令面板：Cmd/Ctrl+Shift+P。
- 文件编码：读取时识别 UTF-8 与 BOM；保存时保留原 BOM 与换行符（LF/CRLF）。不支持的编码以只读方式打开，并给出提示。
- 主题：内置亮色、暗色，默认跟随系统。所有颜色定义为 CSS 变量。

### 7.6 工作区

- 打开文件夹即设定工作区根路径。
- 本体只提供三项能力：
  - 最简文件列表：仅 Markdown 与图片，遵循 `.gitignore`
  - 相对路径解析
  - 向插件与 Agent 暴露 `workspace.root`
- 索引、搜索、标签、双链交给文档库插件。

### 7.7 配置

- 全局配置：`~/.aster/config.json`。
- 工作区配置：`<workspace>/.aster/config.json`，覆盖全局配置。
- 配置项本身也有 JSON Schema，插件 `settings` 合并进同一个设置界面。

## 8. 仓库结构

Cargo workspace + pnpm workspace 单仓库：

```
aster/
├── crates/
│   ├── aster-core/      # 命令注册表、文档、工作区、插件宿主、权限、配置
│   ├── aster-rpc/       # JSON-RPC 协议、socket 服务端与客户端
│   ├── aster-cli/       # CLI 子命令与 MCP server
│   └── aster-app/       # Tauri 2 外壳，产出单一可执行文件 aster
├── packages/
│   ├── editor/          # CodeMirror 6 扩展：实时预览装饰、输入辅助
│   ├── renderer/        # markdown-it 渲染管线（阅览与导出共用）
│   ├── ui/              # SolidJS 界面：标签、命令面板、设置、状态栏
│   └── plugin-api/      # 前端插件 API、TS 类型、manifest JSON Schema
├── plugins/             # 官方插件
└── docs/
```

## 9. 可靠性

- **原子写**：先写同目录临时文件，再 fsync，最后 rename 覆盖原文件。
- **哈希**：文档哈希使用 SHA-256，基于磁盘原始字节计算。
- **文件监听**：使用 `notify` crate。对自身写入产生的事件按哈希去重，避免误报外部修改。
- **崩溃恢复**：未保存内容每 5 秒写入 `~/.aster/recovery/`，下次启动时提示恢复。

## 10. 性能预算

以下指标作为验收标准，纳入 CI 基准测试，超出预算即构建失败。

| 指标 | Lite 版 | 完整版 |
|---|---|---|
| 安装包大小 | < 15 MB | < 40 MB（M3 后校准） |
| 冷启动到可编辑 | < 500 ms | < 500 ms |
| 空载内存 | < 120 MB | < 120 MB |
| 10 万行文档输入延迟 | p95 < 16 ms | 同左 |
| CLI headless 命令（`doc.read`） | < 50 ms | 同左 |

## 11. 测试策略

- **Rust 单元测试**：每个 crate 都有。
- **集成测试**：命令注册表、RPC、headless CLI 端到端测试。
- **前端测试**：Vitest 测装饰逻辑与渲染管线，渲染输出用快照测试。
- **契约测试**：导出注册表的 JSON Schema，校验 CLI `--help`、MCP `tools/list`、命令面板三者一致。
- **E2E**：WebdriverIO + tauri-driver 覆盖以下关键路径：
  - 打开、编辑、保存
  - 外部修改冲突
  - 通过 MCP 执行 `doc.patch` 后在 GUI 中撤销
- **性能基准**：见第 10 节。

## 12. 里程碑

| 里程碑 | 内容 |
|---|---|
| **M1 本体** | aster-core（命令注册表、文档、工作区、配置）；CodeMirror 实时预览、纯源码、阅览模式；沉浸模式；第 7 节全部本体体验；CLI headless 命令；`export.html` |
| **M2 Agent 接入** | aster-rpc；CLI/MCP 连接运行中的 GUI；MCP server；需要 GUI 的 `editor.*` 命令；`doc.patch` 在编辑器中可撤销 |
| **M3 前端插件** | manifest 与校验、权限、懒加载、前端插件 API；内置插件目录；插件包；签名校验；Lite 与完整版双安装包 CI；首批官方插件：主题、Mermaid、数学公式、PDF 导出 |
| **M4 后端插件** | wasmtime 宿主与 WIT 接口定稿；首批官方插件：文档库（索引与搜索）、S3、加密 |

本文档完整覆盖 M1、M2；M3 的插件 API 与 manifest 契约以本文为准；M4 仅定义接口。各官方插件另行编写各自的 spec。
