import { createSignal } from 'solid-js';

export type Lang = 'en' | 'zh';
/** Stored preference: follow the OS, or a fixed language. */
export type LangSetting = 'system' | Lang;

const en = {
  // Tabs
  'tab.untitled': 'Untitled',
  'tab.new': 'New tab ({key})',
  'tab.close': 'Close ({key})',
  'tab.closeLabel': 'Close {name}',
  'tab.unsaved': ' (unsaved changes)',
  'tab.list': 'Open documents',
  'tab.settings': 'Settings',
  'tab.moreNew': 'More actions',
  'tab.menuNew': 'New blank tab',
  'tab.menuOpen': 'Open file…',
  'tab.menuSettings': 'Settings',
  'tab.menuExportPdf': 'Export as PDF…',

  // Status bar
  'status.notSaved': 'Not saved yet',
  'status.words': '{n} words',
  'status.word': '1 word',
  'status.lnCol': 'Ln {line}, Col {col}',
  'status.modeGroup': 'Editor mode',
  'status.live': 'Live',
  'status.source': 'Source',
  'status.liveTip': 'Live preview ({key} to toggle)',
  'status.sourceTip': 'Source ({key} to toggle)',
  'status.readOnly': 'Read-only',
  'status.lockOnTip': 'Read-only — click to edit ({key})',
  'status.lockOffTip': 'Lock editing ({key})',

  // Notices
  'notice.saved': 'Saved {name}',
  'notice.openFailed': 'Could not open {name}: {err}',
  'notice.saveFailed': 'Save failed: {err}',
  'notice.reloadFailed': 'Reload failed: {err}',
  'notice.autoSaveFailed': 'Auto-save failed: {err}',
  'notice.autoSavePaused': '“{name}” changed on disk — auto-save paused. Save manually to resolve.',
  'notice.lockOn': 'Read-only — editing is locked',
  'notice.lockOff': 'Editing unlocked',
  'notice.pdfNeedsPlugin': 'PDF export needs the PDF Export plugin (included in the full edition).',
  'notice.pathCopied': 'Path copied',
  'notice.copyFailed': 'Could not copy',
  'status.copyPath': 'Copy path',

  'ctx.cut': 'Cut',
  'ctx.copy': 'Copy',
  'ctx.paste': 'Paste',
  'ctx.selectAll': 'Select All',
  'ctx.paragraph': 'Paragraph',
  'ctx.insert': 'Insert',
  'ctx.insertTable': 'Table',
  'ctx.heading': 'Heading {n}',
  'ctx.bullet': 'Bullet list',
  'ctx.ordered': 'Numbered list',
  'ctx.task': 'Task list',
  'ctx.quote': 'Quote',
  'ctx.codeBlock': 'Code block',
  'ctx.horizontalRule': 'Horizontal rule',
  'ctx.mathBlock': 'Math block',
  'ctx.mermaidBlock': 'Mermaid diagram',
  'ctx.table': 'Table',
  'ctx.rowAbove': 'Insert row above',
  'ctx.rowBelow': 'Insert row below',
  'ctx.colLeft': 'Insert column left',
  'ctx.colRight': 'Insert column right',
  'ctx.deleteRow': 'Delete row',
  'ctx.deleteCol': 'Delete column',
  'ctx.alignLeft': 'Align left',
  'ctx.alignCenter': 'Align center',
  'ctx.alignRight': 'Align right',
  'ctx.alignNone': 'Clear alignment',
  'ctx.formatTable': 'Format table',
  'ctx.deleteTable': 'Delete table',

  // Confirmations
  'confirm.saveTitle': 'Save changes to “{name}”?',
  'confirm.saveManyTitle': '{n} documents have unsaved changes',
  'confirm.saveBody': "Your changes will be lost if you don't save them.",
  'confirm.dontSave': "Don't Save",
  'confirm.cancel': 'Cancel',
  'confirm.save': 'Save',
  'confirm.saveAll': 'Save All',
  'confirm.diskTitle': '“{name}” changed on disk',
  'confirm.diskBody': 'Another program modified this file after it was opened. Overwrite it with your version, or reload the version on disk?',
  'confirm.reload': 'Reload from Disk',
  'confirm.overwrite': 'Overwrite',

  'dialog.markdown': 'Markdown',
  'window.settings': 'Settings — Aster',

  // Settings: navigation
  'set.title': 'Settings',
  'set.general': 'General',
  'set.appearance': 'Appearance',
  'set.editor': 'Editor',
  'set.plugins': 'Plugins',
  'set.shortcuts': 'Keyboard Shortcuts',
  'set.about': 'About',

  // General
  'set.language': 'Language',
  'set.languageHint': 'Interface language. Your documents are not changed.',
  'set.languageSystem': 'Follow system',
  'set.files': 'Files',
  'set.autoSave': 'Auto-save',
  'set.autoSaveHint': 'Save files a second after you stop typing. New documents still need a first manual save.',

  // Appearance
  'set.theme': 'Theme',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  // Editor: typography
  'set.typography': 'Typography',
  'set.followTheme': 'Use theme fonts',
  'set.followThemeHint': 'Each theme brings its own fonts. Turn off to choose yours.',
  'set.fontStyle': 'Font style',
  'set.fontStyleHint': 'A preset, or pick body and code fonts yourself.',
  'preset.serif': 'Serif',
  'preset.sans': 'Sans-serif',
  'preset.custom': 'Custom',
  'set.textFont': 'Text font',
  'set.textFontHint': 'Used for paragraphs and headings',
  'set.monoFont': 'Monospace font',
  'set.monoFontHint': 'Used for code. Only fixed-width fonts are listed.',
  'set.fontSearch': 'Search fonts',
  'set.fontPresets': 'Presets',
  'set.fontInstalled': 'Installed fonts',
  'set.fontLoading': 'Loading installed fonts…',
  'set.fontNoMatch': 'No matching fonts',
  'set.fontUseTyped': 'Use “{name}”',
  'set.preview': 'Preview',
  'set.previewHeading': 'The quick brown fox',
  'set.previewBody': 'Typography shapes how a page reads. 好的排版让文字更易读。',

  // Editor: layout
  'set.layout': 'Layout',
  'set.showMenuBar': 'Show menu bar',
  'set.showMenuBarHint': 'Show File, Edit, View and Window below the title bar. Shortcuts and the tab menu remain available when hidden.',
  'set.fontSize': 'Font size',
  'set.lineHeight': 'Line height',
  'set.lineWidth': 'Line width',
  'set.lineWidthHint': 'Maximum width of the text column',
  'width.narrow': 'Narrow',
  'width.comfortable': 'Comfortable',
  'width.wide': 'Wide',
  'width.full': 'Full',

  // Editor: behavior
  'set.behavior': 'Behavior',
  'set.lineNumbers': 'Line numbers',
  'set.lineNumbersHint': 'Show line numbers in the gutter',
  'set.typewriter': 'Typewriter scrolling',
  'set.typewriterHint': 'Keep the line you are typing in the middle of the window',

  // Plugins / about
  'set.noPlugins': 'No plugins installed. The full edition ships with math, diagrams, PDF export and more.',
  'set.builtIn': 'Built-in',
  'set.user': 'User',
  'set.tagline': 'Markdown editor for people and agents',
  'rail.label': 'Headings',
  'recovery.text': 'Recovered {n} unsaved document(s) from a session that ended unexpectedly.',
  'recovery.discard': 'Discard',
  'recovery.keep': 'Keep',
  'set.outlineRail': 'Heading navigator',
  'set.outlineRailHint': 'Dashes on the right edge for headings 1–3; hover to see titles, click to jump',
  'set.backup': 'Backup & reset',
  'set.export': 'Export settings',
  'set.exportHint': 'Save your settings to a JSON file. Plugins are listed by name, not included.',
  'set.import': 'Import settings',
  'set.importHint': 'Load settings from a file. You can review what changes before anything is applied.',
  'set.reset': 'Restore defaults',
  'set.resetHint': 'Reset every setting to its default. Documents and plugins are not affected.',
  'set.exportBtn': 'Export…',
  'set.importBtn': 'Import…',
  'set.resetBtn': 'Restore…',
  'notice.exported': 'Settings exported to {name}',
  'notice.imported': 'Settings imported',
  'notice.importFailed': 'Could not import: {err}',
  'notice.reset': 'Settings restored to defaults',
  'import.notSettings': 'this is not an Aster settings file',
  'import.tooNew': 'the file was made by a newer version of Aster',
  'import.badJson': 'the file is not valid JSON',
  'confirm.importTitle': 'Import settings from “{name}”?',
  'confirm.importChanges': '{n} setting(s) will change: {list}.',
  'confirm.importNoChange': 'This file matches your current settings.',
  'confirm.importDropped': 'Ignored (unknown or invalid): {list}.',
  'confirm.importPlugins': 'Plugins mentioned but not installed: {list}. Importing settings never installs plugins.',
  'confirm.importTheme': 'Theme “{name}” comes from a plugin that isn’t installed; the system theme is used until it is.',
  'confirm.import': 'Import',
  'confirm.resetTitle': 'Restore default settings?',
  'confirm.resetBody': 'Every setting returns to its default. This can’t be undone, but you can export a backup first.',
  'confirm.resetExportFirst': 'Export Backup First',
  'confirm.reset': 'Restore Defaults',
  'dialog.settingsJson': 'Aster settings',
  'about.edition': 'Version {v}',
  'about.license': 'Open source under the MIT License',
  'about.github': 'View on GitHub',

  // Font names
  'font.sans': 'System sans-serif',
  'font.serif': 'Book serif',
  'font.mono': 'System monospace',
  'font.wenkai': 'LXGW WenKai',

  // Shortcuts
  'sc.formatting': 'Formatting',
  'sc.editing': 'Editing',
  'sc.files': 'Files & Tabs',
  'sc.bold': 'Bold',
  'sc.italic': 'Italic',
  'sc.code': 'Inline code',
  'sc.strike': 'Strikethrough',
  'sc.link': 'Link',
  'sc.heading': 'Heading 1–6',
  'sc.paragraph': 'Paragraph',
  'sc.bullet': 'Bullet list',
  'sc.ordered': 'Numbered list',
  'sc.task': 'Task list',
  'sc.quote': 'Quote',
  'sc.codeBlock': 'Code block',
  'sc.table': 'Table',
  'sc.find': 'Find / Replace',
  'sc.toggleMode': 'Toggle Live / Source',
  'sc.toggleLock': 'Toggle read-only',
  'sc.indent': 'Indent / Outdent list item',
  'sc.newTab': 'New tab',
  'sc.open': 'Open',
  'sc.save': 'Save',
  'sc.saveAs': 'Save as',
  'sc.closeTab': 'Close tab',
  'sc.cycleTab': 'Next / Previous tab',
  'sc.settings': 'Settings',
};

export type Key = keyof typeof en;

const zh: Record<Key, string> = {
  'tab.untitled': '未命名',
  'tab.new': '新建标签页（{key}）',
  'tab.close': '关闭（{key}）',
  'tab.closeLabel': '关闭 {name}',
  'tab.unsaved': '（有未保存的更改）',
  'tab.list': '已打开的文档',
  'tab.settings': '设置',
  'tab.moreNew': '更多操作',
  'tab.menuNew': '新建空白页',
  'tab.menuOpen': '打开文件…',
  'tab.menuSettings': '设置',
  'tab.menuExportPdf': '导出为 PDF…',

  'status.notSaved': '尚未保存',
  'status.words': '{n} 字',
  'status.word': '1 字',
  'status.lnCol': '第 {line} 行，第 {col} 列',
  'status.modeGroup': '编辑模式',
  'status.live': '实时',
  'status.source': '源码',
  'status.liveTip': '实时预览（{key} 切换）',
  'status.sourceTip': '源码（{key} 切换）',
  'status.readOnly': '只读',
  'status.lockOnTip': '只读中，点击恢复编辑（{key}）',
  'status.lockOffTip': '锁定为只读（{key}）',

  'notice.saved': '已保存 {name}',
  'notice.openFailed': '无法打开 {name}：{err}',
  'notice.saveFailed': '保存失败：{err}',
  'notice.reloadFailed': '重新载入失败：{err}',
  'notice.autoSaveFailed': '自动保存失败：{err}',
  'notice.autoSavePaused': '“{name}”已在磁盘上被修改，自动保存已暂停。请手动保存以处理冲突。',
  'notice.lockOn': '已锁定为只读',
  'notice.lockOff': '已恢复编辑',
  'notice.pdfNeedsPlugin': 'PDF 导出需要 PDF 导出插件（完整版自带）。',
  'notice.pathCopied': '已复制路径',
  'notice.copyFailed': '无法复制',
  'status.copyPath': '复制路径',

  'ctx.cut': '剪切',
  'ctx.copy': '拷贝',
  'ctx.paste': '粘贴',
  'ctx.selectAll': '全选',
  'ctx.paragraph': '正文',
  'ctx.insert': '插入',
  'ctx.insertTable': '表格',
  'ctx.heading': '{n} 级标题',
  'ctx.bullet': '无序列表',
  'ctx.ordered': '有序列表',
  'ctx.task': '任务列表',
  'ctx.quote': '引用',
  'ctx.codeBlock': '代码块',
  'ctx.horizontalRule': '分隔线',
  'ctx.mathBlock': '数学公式',
  'ctx.mermaidBlock': 'Mermaid 图表',
  'ctx.table': '表格',
  'ctx.rowAbove': '在上方插入行',
  'ctx.rowBelow': '在下方插入行',
  'ctx.colLeft': '在左侧插入列',
  'ctx.colRight': '在右侧插入列',
  'ctx.deleteRow': '删除行',
  'ctx.deleteCol': '删除列',
  'ctx.alignLeft': '左对齐',
  'ctx.alignCenter': '居中',
  'ctx.alignRight': '右对齐',
  'ctx.alignNone': '清除对齐',
  'ctx.formatTable': '整理表格',
  'ctx.deleteTable': '删除表格',

  'confirm.saveTitle': '要保存对“{name}”的更改吗？',
  'confirm.saveManyTitle': '{n} 个文档有未保存的更改',
  'confirm.saveBody': '如果不保存，你的更改将会丢失。',
  'confirm.dontSave': '不保存',
  'confirm.cancel': '取消',
  'confirm.save': '保存',
  'confirm.saveAll': '全部保存',
  'confirm.diskTitle': '“{name}”已在磁盘上被修改',
  'confirm.diskBody': '打开此文件后，另一个程序修改了它。要用你的版本覆盖，还是重新载入磁盘上的版本？',
  'confirm.reload': '重新载入',
  'confirm.overwrite': '覆盖',

  'dialog.markdown': 'Markdown 文档',
  'window.settings': '设置 — Aster',

  'set.title': '设置',
  'set.general': '通用',
  'set.appearance': '外观',
  'set.editor': '编辑器',
  'set.plugins': '插件',
  'set.shortcuts': '快捷键',
  'set.about': '关于',

  'set.language': '语言',
  'set.languageHint': '界面语言，不影响文档内容。',
  'set.languageSystem': '跟随系统',
  'set.files': '文件',
  'set.autoSave': '自动保存',
  'set.autoSaveHint': '停止输入一秒后自动保存。新建的文档仍需先手动保存一次。',

  'set.theme': '主题',
  'theme.system': '跟随系统',
  'theme.light': '浅色',
  'theme.dark': '深色',

  'set.typography': '字体',
  'set.followTheme': '使用主题字体',
  'set.followThemeHint': '每个主题自带一套字体。关闭后可自行选择。',
  'set.fontStyle': '字体风格',
  'set.fontStyleHint': '使用预设，或分别选择正文和代码字体。',
  'preset.serif': '衬线',
  'preset.sans': '无衬线',
  'preset.custom': '自定义',
  'set.textFont': '正文字体',
  'set.textFontHint': '用于段落和标题',
  'set.monoFont': '等宽字体',
  'set.monoFontHint': '用于代码。只列出等宽字体。',
  'set.fontSearch': '搜索字体',
  'set.fontPresets': '预设',
  'set.fontInstalled': '已安装的字体',
  'set.fontLoading': '正在读取已安装的字体…',
  'set.fontNoMatch': '没有匹配的字体',
  'set.fontUseTyped': '使用“{name}”',
  'set.preview': '预览',
  'set.previewHeading': '敏捷的棕色狐狸',
  'set.previewBody': '好的排版让文字更易读。Typography shapes how a page reads.',

  'set.layout': '版式',
  'set.showMenuBar': '显示菜单栏',
  'set.showMenuBarHint': '在标题栏下显示“文件、编辑、显示、窗口”。隐藏时仍可使用快捷键和标签栏的更多操作。',
  'set.fontSize': '字号',
  'set.lineHeight': '行高',
  'set.lineWidth': '行宽',
  'set.lineWidthHint': '正文栏的最大宽度',
  'width.narrow': '窄',
  'width.comfortable': '适中',
  'width.wide': '宽',
  'width.full': '铺满',

  'set.behavior': '行为',
  'set.lineNumbers': '行号',
  'set.lineNumbersHint': '在左侧显示行号',
  'set.typewriter': '打字机滚动',
  'set.typewriterHint': '让正在输入的行保持在窗口中间',

  'set.noPlugins': '尚未安装插件。完整版自带数学公式、图表、PDF 导出等插件。',
  'set.builtIn': '内置',
  'set.user': '用户',
  'set.tagline': '为人和智能体设计的 Markdown 编辑器',
  'rail.label': '标题导航',
  'recovery.text': '上次异常退出，已恢复 {n} 个未保存的文档。',
  'recovery.discard': '丢弃',
  'recovery.keep': '保留',
  'set.outlineRail': '标题导航条',
  'set.outlineRailHint': '在编辑区右侧用短横线表示一至三级标题；悬停查看标题，点击跳转',
  'set.backup': '备份与重置',
  'set.export': '导出设置',
  'set.exportHint': '把设置保存为 JSON 文件。插件只记录名称，不会打包进文件。',
  'set.import': '导入设置',
  'set.importHint': '从文件载入设置。应用前会先列出将要改变的内容。',
  'set.reset': '恢复默认设置',
  'set.resetHint': '把所有设置恢复为默认值，不影响文档和插件。',
  'set.exportBtn': '导出…',
  'set.importBtn': '导入…',
  'set.resetBtn': '恢复…',
  'notice.exported': '设置已导出到 {name}',
  'notice.imported': '设置已导入',
  'notice.importFailed': '无法导入：{err}',
  'notice.reset': '已恢复默认设置',
  'import.notSettings': '这不是 Aster 的设置文件',
  'import.tooNew': '该文件来自更新版本的 Aster',
  'import.badJson': '文件不是有效的 JSON',
  'confirm.importTitle': '要从“{name}”导入设置吗？',
  'confirm.importChanges': '将改变 {n} 项设置：{list}。',
  'confirm.importNoChange': '该文件与当前设置一致。',
  'confirm.importDropped': '已忽略（无法识别或不合法）：{list}。',
  'confirm.importPlugins': '文件中提到但尚未安装的插件：{list}。导入设置不会安装任何插件。',
  'confirm.importTheme': '主题“{name}”来自未安装的插件，安装前将使用跟随系统的主题。',
  'confirm.import': '导入',
  'confirm.resetTitle': '要恢复默认设置吗？',
  'confirm.resetBody': '所有设置都会恢复为默认值，此操作无法撤销。你可以先导出一份备份。',
  'confirm.resetExportFirst': '先导出备份',
  'confirm.reset': '恢复默认',
  'dialog.settingsJson': 'Aster 设置',
  'about.edition': '版本 {v}',
  'about.license': '基于 MIT 许可证开源',
  'about.github': '在 GitHub 上查看',

  'font.sans': '系统无衬线',
  'font.serif': '书籍衬线',
  'font.mono': '系统等宽',
  'font.wenkai': '霞鹜文楷',

  'sc.formatting': '格式',
  'sc.editing': '编辑',
  'sc.files': '文件与标签页',
  'sc.bold': '加粗',
  'sc.italic': '斜体',
  'sc.code': '行内代码',
  'sc.strike': '删除线',
  'sc.link': '链接',
  'sc.heading': '标题 1–6',
  'sc.paragraph': '正文',
  'sc.bullet': '无序列表',
  'sc.ordered': '有序列表',
  'sc.task': '任务列表',
  'sc.quote': '引用',
  'sc.codeBlock': '代码块',
  'sc.table': '表格',
  'sc.find': '查找 / 替换',
  'sc.toggleMode': '切换实时 / 源码',
  'sc.toggleLock': '切换只读',
  'sc.indent': '列表缩进 / 取消缩进',
  'sc.newTab': '新建标签页',
  'sc.open': '打开',
  'sc.save': '保存',
  'sc.saveAs': '另存为',
  'sc.closeTab': '关闭标签页',
  'sc.cycleTab': '下一个 / 上一个标签页',
  'sc.settings': '设置',
};

const DICTS: Record<Lang, Record<Key, string>> = { en, zh };

export function systemLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const tag = (nav?.languages?.[0] ?? nav?.language ?? 'en').toLowerCase();
  return tag.startsWith('zh') ? 'zh' : 'en';
}

const [lang, setLang] = createSignal<Lang>(systemLang());
export { lang };

export function resolveLang(setting: LangSetting): Lang {
  return setting === 'system' ? systemLang() : setting;
}

export function applyLanguage(setting: LangSetting): Lang {
  const l = resolveLang(setting);
  setLang(l);
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  return l;
}

/** Translate `key` in the current language; `{name}` placeholders are filled from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const s = DICTS[lang()][key] ?? en[key];
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : s;
}

/** Pick a localized string from a `{ zh: '…' }` map, falling back to `fallback`. */
export function pick(map: Record<string, string | undefined> | undefined, fallback: string): string {
  return map?.[lang()] ?? fallback;
}

/** CodeMirror UI phrases (search panel etc.). English is CodeMirror's default. */
export function editorPhrases(l: Lang): Record<string, string> {
  if (l !== 'zh') return {};
  return {
    'Find': '查找',
    'Replace': '替换',
    'next': '下一个',
    'previous': '上一个',
    'all': '全部',
    'match case': '区分大小写',
    'regexp': '正则',
    'by word': '全词',
    'replace': '替换',
    'replace all': '全部替换',
    'close': '关闭',
    'current match': '当前匹配',
    'on line': '位于行',
    'replaced $ matches': '已替换 $ 处',
    'replaced match on line $': '已替换第 $ 行的匹配',
    'Go to line': '跳转到行',
    'go': '跳转',
    'Control character': '控制字符',
    'folded code': '已折叠的代码',
    'unfold': '展开',
    'Completions': '补全',
  };
}

export const WELCOME: Record<Lang, (mod: string) => string> = {
  en: (m) => `# Welcome to Aster

Start writing. Live preview hides the markup as you leave a line.

**Bold** with ${m}B, *italic* with ${m}I, \`code\` with ${m}E, [links](url) with ${m}K.

- Lists continue on Enter
- [ ] Tasks toggle with a click
- Headings: ${m}1 – ${m}6

Open a file with ${m}O, save with ${m}S, new tab with ${m}N. Settings live at ${m},.
`,
  zh: (m) => `# 欢迎使用 Aster

开始写作吧。光标离开一行后，实时预览会隐藏 Markdown 标记。

${m}B **加粗**，${m}I *斜体*，${m}E \`代码\`，${m}K 插入[链接](url)。

- 按回车自动续写列表
- [ ] 点击即可勾选任务
- 标题：${m}1 – ${m}6

${m}O 打开文件，${m}S 保存，${m}N 新建标签页，${m}, 打开设置。
`,
};
