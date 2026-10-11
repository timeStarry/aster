import { createSignal, createMemo, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getVersion } from '@tauri-apps/api/app';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { EditorState } from '@codemirror/state';
import { createEditor, openSearchPanel, refreshCodeBlocks, outline, visibleRange, revealPos, type AsterEditor, type OutlineItem } from '@aster/editor';
import { createDefaultPipeline } from '@aster/renderer';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { SettingsPane, type PluginRow } from './SettingsPane';
import type { InstalledFont } from './FontCombobox';
import { ConfirmModal, type ConfirmRequest, type ConfirmButton } from './ConfirmModal';
import { initPluginLoader, activateForTrigger, asterApi, type LoadablePlugin } from './plugin-loader';
import {
  type Tab, type Settings, type EditorMode, type PluginTheme,
  loadSettings, saveSettings, applySettings, DEFAULT_SETTINGS, makeTab, basename, dirname, wordCount, isMac, isWindows, MOD, fileUrl,
} from './model';
import { t, lang, applyLanguage, editorPhrases, WELCOME, type Lang } from './i18n';
import { showEditorContextMenu } from './contextmenu';
import { OutlineRail } from './OutlineRail';
import { buildBackup, planImport, BackupError, SETTING_LABELS as SETTING_LABEL } from './backup';
import { shortcutAction } from './shortcuts';
import './theme.css';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const MD_EXTS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];
const mdFilters = () => [{ name: t('dialog.markdown'), extensions: MD_EXTS }];
const pipeline = createDefaultPipeline();

interface AsterErr { code?: string; message?: string }
const errText = (e: unknown) => (e as AsterErr)?.message ?? String(e);

const SETTINGS_ID = 'settings';

interface PluginInfo {
  id: string; name: string; version: string; description?: string; activation: string[];
  frontend_path: string | null; source: string;
  i18n?: Record<string, { name?: string; description?: string }>;
}

/** Base URL of Tauri's asset protocol on this platform. */
function assetBase(): string {
  // convertFileSrc('') yields e.g. "asset://localhost/" or "http://asset.localhost/".
  try { return convertFileSrc(''); } catch { return 'asset://localhost/'; }
}

export default function App() {
  const [settings, setSettingsSig] = createSignal<Settings>(loadSettings());
  applyLanguage(settings().language);
  applySettings(settings());

  const welcomeText = (l: Lang) => WELCOME[l](MOD);
  const first = makeTab({ content: welcomeText(lang()) }, [], t('tab.untitled'));
  const [tabs, setTabs] = createSignal<Tab[]>([first]);
  const [activeId, setActiveId] = createSignal(first.id);
  const [mode, setMode] = createSignal<EditorMode>('live');
  const [readOnly, setReadOnly] = createSignal(false);
  const [cursor, setCursor] = createSignal({ line: 1, col: 1 });
  // Heading navigator state.
  const [headings, setHeadings] = createSignal<OutlineItem[]>([]);
  const [vis, setVis] = createSignal({ from: 0, to: 0 });
  const [cursorPos, setCursorPos] = createSignal(0);
  const [railIdle, setRailIdle] = createSignal(false);
  let railTimer: number | undefined;
  let outlineTimer: number | undefined;
  const [notice, setNotice] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [version, setVersion] = createSignal('');
  const [inset, setInset] = createSignal(isMac && inTauri);
  const [confirmReq, setConfirmReq] = createSignal<ConfirmRequest | null>(null);
  // Tabs restored from a session that ended abruptly; shown in a banner.
  const [recoveredIds, setRecoveredIds] = createSignal<string[]>([]);
  const [plugins, setPlugins] = createSignal<PluginRow[]>([]);
  const [pluginThemes, setPluginThemes] = createSignal<PluginTheme[]>([]);
  // Installed fonts are scanned lazily the first time Settings opens.
  const [fonts, setFonts] = createSignal<InstalledFont[] | null>(null);
  let fontsRequested = false;
  function loadFonts() {
    if (fontsRequested) return;
    fontsRequested = true;
    if (!inTauri) { setFonts([]); return; }
    invoke<InstalledFont[]>('fonts_list').then(setFonts, () => setFonts([]));
  }
  let loadable: LoadablePlugin[] = [];
  const pluginUrl = (_id: string, path: string) => fileUrl(path, assetBase());

  // Editor states are kept outside the reactive graph: Solid must not proxy them.
  const states = new Map<string, EditorState>();
  const autoSaveTimers = new Map<string, number>();
  const conflicted = new Set<string>();
  let editor: AsterEditor | null = null;
  /** Document currently loaded in the editor (stays set while Settings is shown). */
  let editorDocId = first.id;
  let host!: HTMLDivElement;
  let noticeTimer: number | undefined;

  const tab = (id: string) => tabs().find((tb) => tb.id === id);
  const active = createMemo(() => tab(activeId()));
  const onSettings = () => activeId() === SETTINGS_ID;
  const words = createMemo(() => wordCount(active()?.content ?? ''));
  const updateTab = (id: string, patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((tb) => (tb.id === id ? { ...tb, ...patch } : tb)));

  function flash(text: string, error = false) {
    setNotice({ text, error });
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => setNotice(null), error ? 6000 : 2500);
  }

  function ask(title: string, message: string, buttons: ConfirmButton[], cancelId: string): Promise<string> {
    return new Promise((resolve) => {
      setConfirmReq({ title, message, buttons, cancelId, resolve: (id) => { setConfirmReq(null); resolve(id); } });
    });
  }

  // ── Tabs ───────────────────────────────────────────────────
  function activate(id: string) {
    const cur = activeId();
    if (id === cur && editor) return;
    setActiveId(id);
    if (id === SETTINGS_ID || !editor) return;
    const tb = tab(id);
    if (!tb) return;
    if (id !== editorDocId) {
      if (tab(editorDocId)) states.set(editorDocId, editor.view.state);
      editor.setState(states.get(id) ?? editor.createState(tb.content));
      editorDocId = id;
    }
    updateCursor(editor.view.state);
    scheduleOutline();
    // The editor was hidden while Settings was shown; re-measure before focusing.
    editor.view.requestMeasure();
    editor.focus();
  }

  /** Settings is a singleton tab: open it, or focus it if already open. */
  function openSettings() {
    loadFonts();
    setSettingsOpen(true);
    activate(SETTINGS_ID);
  }

  // ── Crash recovery ─────────────────────────────────────────
  // Every tab with unsaved changes (never-saved or edited) is snapshotted to
  // ~/.aster/session a second after it changes. A clean quit deletes the
  // snapshot, so finding one at startup means the last session crashed.
  const unsaved = () => tabs().filter((tb) => tb.dirty);
  let sessionTimer: number | undefined;
  let sessionChain: Promise<void> = Promise.resolve();
  function scheduleSession() {
    if (!inTauri) return;
    clearTimeout(sessionTimer);
    sessionTimer = window.setTimeout(() => void saveSession(), 1000);
  }
  /** Write the snapshot now (an empty list deletes it). Writes are serialized. */
  function saveSession(): Promise<void> {
    if (!inTauri) return Promise.resolve();
    clearTimeout(sessionTimer);
    const list = unsaved().map((tb) => ({ title: tb.title, path: tb.path, content: tb.content, hash: tb.path ? tb.hash : null }));
    sessionChain = sessionChain
      .then(() => invoke('session_save', { snapshot: { version: 1, savedAt: Date.now(), tabs: list } }))
      .then(() => {}, () => {});
    return sessionChain;
  }

  function newTab() {
    const nt = makeTab({}, tabs(), t('tab.untitled'));
    setTabs((ts) => [...ts, nt]);
    activate(nt.id);
  }

  function cycleTab(dir: 1 | -1) {
    const ids = [...tabs().map((tb) => tb.id), ...(settingsOpen() ? [SETTINGS_ID] : [])];
    const i = ids.indexOf(activeId());
    activate(ids[(i + dir + ids.length) % ids.length]);
  }

  async function closeTab(id: string): Promise<boolean> {
    if (id === SETTINGS_ID) {
      setSettingsOpen(false);
      if (activeId() === SETTINGS_ID) {
        setActiveId('');
        activate(tab(editorDocId) ? editorDocId : tabs()[tabs().length - 1].id);
      }
      return true;
    }
    const tb = tab(id);
    if (!tb) return true;
    if (tb.dirty) {
      const choice = await ask(
        t('confirm.saveTitle', { name: tb.title }),
        t('confirm.saveBody'),
        [
          { id: 'discard', label: t('confirm.dontSave'), kind: 'danger' },
          { id: 'cancel', label: t('confirm.cancel') },
          { id: 'save', label: t('confirm.save'), kind: 'primary' },
        ],
        'cancel',
      );
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await saveTab(id))) return false;
    }
    const ts = tabs();
    const idx = ts.findIndex((x) => x.id === id);
    let rest = ts.filter((x) => x.id !== id);
    states.delete(id);
    clearTimeout(autoSaveTimers.get(id));
    conflicted.delete(id);
    if (rest.length === 0) rest = [makeTab({}, [], t('tab.untitled'))];
    setTabs(rest);
    setRecoveredIds((ids) => ids.filter((x) => x !== id));
    scheduleSession();
    const next = rest[Math.min(idx, rest.length - 1)].id;
    if (activeId() === id) {
      setActiveId('');
      activate(next);
    } else if (editorDocId === id && editor) {
      // Closed (e.g. middle-click) while Settings was showing: load a live doc
      // into the hidden editor so it never points at a removed tab.
      const t2 = tab(next)!;
      editor.setState(states.get(next) ?? editor.createState(t2.content));
      editorDocId = next;
    }
    return true;
  }

  // ── Files ──────────────────────────────────────────────────
  function isPristine(tb: Tab | undefined) {
    return !!tb && !tb.path && !tb.dirty && (tb.content === '' || tb.content === welcomeText('en') || tb.content === welcomeText('zh'));
  }

  async function openPath(path: string) {
    const existing = tabs().find((tb) => tb.path === path);
    if (existing) { activate(existing.id); return; }
    try {
      const r = await invoke<{ content: string; hash: string }>('dispatch', { id: 'doc.read', params: { path } });
      const replace = isPristine(active()) ? active()! : null;
      const nt = makeTab({ path, content: r.content, hash: r.hash }, tabs());
      if (replace) {
        states.delete(replace.id);
        setTabs((ts) => ts.map((x) => (x.id === replace.id ? nt : x)));
      } else {
        setTabs((ts) => [...ts, nt]);
      }
      activate(nt.id);
    } catch (e) {
      flash(t('notice.openFailed', { name: basename(path), err: errText(e) }), true);
    }
  }

  async function openFiles() {
    const picked = await openDialog({ multiple: true, filters: mdFilters() });
    if (!picked) return;
    for (const p of Array.isArray(picked) ? picked : [picked]) await openPath(p);
  }

  function currentContent(id: string): string {
    return id === editorDocId && editor ? editor.getContent() : tab(id)?.content ?? '';
  }

  async function writeFile(id: string, path: string, content: string, expectedHash?: string) {
    return invoke<{ hash: string }>('auto_save', { path, content, expectedHash });
  }

  function markSaved(id: string, path: string, content: string, hash: string) {
    const tb = tab(id);
    if (!tb) return;
    updateTab(id, { path, title: basename(path), saved: content, hash, dirty: tb.content !== content });
    conflicted.delete(id);
    scheduleSession();
  }

  /** Save a tab. Returns false if the user cancelled or the write failed. */
  async function saveTab(id: string, saveAs = false): Promise<boolean> {
    const tb = tab(id);
    if (!tb) return false;
    let path = tb.path;
    if (!path || saveAs) {
      const picked = await saveDialog({ defaultPath: tb.path ?? `${tb.title}.md`, filters: mdFilters() });
      if (!picked) return false;
      path = picked;
    }
    const content = currentContent(id);
    const expected = path === tb.path ? tb.hash ?? undefined : undefined;
    try {
      const r = await writeFile(id, path, content, expected);
      markSaved(id, path, content, r.hash);
      flash(t('notice.saved', { name: basename(path) }));
      return true;
    } catch (e) {
      if ((e as AsterErr)?.code !== 'E_CONFLICT') {
        flash(t('notice.saveFailed', { err: errText(e) }), true);
        return false;
      }
      const choice = await ask(
        t('confirm.diskTitle', { name: basename(path) }),
        t('confirm.diskBody'),
        [
          { id: 'reload', label: t('confirm.reload'), kind: 'danger' },
          { id: 'cancel', label: t('confirm.cancel') },
          { id: 'overwrite', label: t('confirm.overwrite'), kind: 'primary' },
        ],
        'cancel',
      );
      if (choice === 'cancel') return false;
      if (choice === 'reload') { await reloadTab(id); return false; }
      try {
        const r = await writeFile(id, path, content);
        markSaved(id, path, content, r.hash);
        flash(t('notice.saved', { name: basename(path) }));
        return true;
      } catch (e2) {
        flash(t('notice.saveFailed', { err: errText(e2) }), true);
        return false;
      }
    }
  }

  async function saveAllDirty(): Promise<boolean> {
    for (const tb of tabs().filter((x) => x.dirty)) {
      activate(tb.id);
      if (!(await saveTab(tb.id))) return false;
    }
    return true;
  }

  /** Discard restored tabs without prompting (the user chose to throw them away). */
  function discardRecovered() {
    const ids = new Set(recoveredIds());
    setRecoveredIds([]);
    let rest = tabs().filter((tb) => !ids.has(tb.id));
    ids.forEach((id) => states.delete(id));
    if (rest.length === 0) rest = [makeTab({}, [], t('tab.untitled'))];
    setTabs(rest);
    if (ids.has(activeId()) || ids.has(editorDocId)) {
      setActiveId('');
      editorDocId = '';
      activate(rest[0].id);
    }
    void saveSession();
  }

  async function reloadTab(id: string) {
    const tb = tab(id);
    if (!tb?.path) return;
    try {
      const r = await invoke<{ content: string; hash: string }>('dispatch', { id: 'doc.read', params: { path: tb.path } });
      updateTab(id, { content: r.content, saved: r.content, hash: r.hash, dirty: false });
      conflicted.delete(id);
      states.delete(id);
      if (id === editorDocId && editor) editor.setState(editor.createState(r.content));
    } catch (e) {
      flash(t('notice.reloadFailed', { err: errText(e) }), true);
    }
  }

  function scheduleAutoSave(id: string) {
    clearTimeout(autoSaveTimers.get(id));
    if (!settings().autoSave || conflicted.has(id)) return;
    autoSaveTimers.set(id, window.setTimeout(async () => {
      const tb = tab(id);
      if (!tb?.path || !tb.dirty || conflicted.has(id)) return;
      const content = tb.content;
      try {
        const r = await writeFile(id, tb.path, content, tb.hash ?? undefined);
        markSaved(id, tb.path, content, r.hash);
      } catch (e) {
        if ((e as AsterErr)?.code === 'E_CONFLICT') {
          conflicted.add(id);
          flash(t('notice.autoSavePaused', { name: tb.title }), true);
        } else {
          flash(t('notice.autoSaveFailed', { err: errText(e) }), true);
        }
      }
    }, 1000));
  }

  // ── Modes & settings ───────────────────────────────────────
  function changeMode(m: EditorMode) {
    setMode(m);
    editor?.setMode(m);
    editor?.focus();
  }

  function toggleLock() {
    const on = !readOnly();
    setReadOnly(on);
    editor?.setReadOnly(on);
    flash(on ? t('notice.lockOn') : t('notice.lockOff'));
  }

  /** Push the current language to the parts that don't read `t()` reactively. */
  function syncLanguage(l: Lang) {
    editor?.setPhrases(editorPhrases(l));
    syncNativeMenu(l);
    // Untouched welcome tab: show it in the new language too.
    const w = tabs().find((tb) => !tb.path && !tb.dirty && (tb.content === welcomeText('en') || tb.content === welcomeText('zh')));
    if (w && w.content !== welcomeText(l)) {
      const text = welcomeText(l);
      updateTab(w.id, { content: text, saved: text });
      if (w.id === editorDocId && editor) {
        editor.setState(editor.createState(text));
      } else {
        states.delete(w.id);
      }
    }
    // Rename untitled tabs that still carry the other language's base name.
    const other = l === 'zh' ? 'Untitled' : '未命名';
    const base = t('tab.untitled');
    setTabs((ts) => ts.map((tb) => (!tb.path && (tb.title === other || tb.title.startsWith(other + ' '))
      ? { ...tb, title: base + tb.title.slice(other.length) }
      : tb)));
  }

  function syncNativeMenu(l = lang()) {
    if (inTauri) void invoke('set_menu_language', { lang: l, visible: settings().showMenuBar })
      .catch((error) => console.error('[aster] menu preferences failed:', error));
  }

  function changeSettings(s: Settings) {
    const themeChanged = s.theme !== settings().theme;
    const langChanged = s.language !== settings().language;
    const menuChanged = s.showMenuBar !== settings().showMenuBar;
    setSettingsSig(s);
    saveSettings(s);
    const applied = applySettings(s, pluginThemes());
    if (langChanged) syncLanguage(applyLanguage(s.language));
    else if (menuChanged) syncNativeMenu();
    // Diagrams pick colors from the theme at render time.
    // Diagrams read theme colors at render time: re-render once the new
    // palette (including a plugin stylesheet) is actually applied.
    if (themeChanged) void applied.then(() => editor && refreshCodeBlocks(editor.view, { clearCache: true }));
    editor?.setSettings({ lineNumbers: s.lineNumbers, typewriter: s.typewriter });
    editor?.view.requestMeasure();
  }

  /** Recompute headings soon after edits; cheap enough to debounce lightly. */
  function scheduleOutline() {
    clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(() => {
      if (!editor) return;
      setHeadings(outline(editor.view.state, 3));
      updateVisible();
    }, 120);
  }
  function updateVisible() {
    if (!editor) return;
    setVis(visibleRange(editor.view));
  }
  /** While typing, fade the rail after a pause; the pointer near it brings it back. */
  function noteTyping() {
    clearTimeout(railTimer);
    railTimer = window.setTimeout(() => setRailIdle(true), 1500);
  }
  function wakeRail() {
    clearTimeout(railTimer);
    setRailIdle(false);
  }

  function updateCursor(state: EditorState) {
    const head = state.selection.main.head;
    setCursorPos(head);
    const line = state.doc.lineAt(head);
    setCursor({ line: line.number, col: head - line.from + 1 });
  }

  function resolveImage(src: string): string {
    if (!inTauri || /^(https?:|data:|blob:|asset:)/i.test(src)) return src;
    let p = src;
    try { p = decodeURI(src); } catch { /* keep raw */ }
    if (!p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p)) {
      const base = active()?.path;
      if (!base) return src;
      p = `${dirname(base)}/${p}`;
    }
    return convertFileSrc(p);
  }

  async function copyPath() {
    const p = active()?.path;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      flash(t('notice.pathCopied'));
    } catch {
      flash(t('notice.copyFailed'), true);
    }
  }

  function onContextMenu(e: MouseEvent) {
    // Inputs and the settings page keep the native text menu.
    const target = e.target as HTMLElement;
    if (!editor || !inTauri) return;
    if (!host.contains(target)) {
      if (!target.closest('input, textarea, [contenteditable="true"], .aster-selectable')) e.preventDefault();
      return;
    }
    e.preventDefault();
    const view = editor.view;
    // Right-click outside the selection moves the cursor there first (as in native editors).
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const sel = view.state.selection.main;
    if (pos != null && (pos < sel.from || pos > sel.to)) view.dispatch({ selection: { anchor: pos } });
    const renderable = ['math', 'mermaid'].filter((l) => loadable.some((p) => p.activation.includes(`onCodeBlock:${l}`)));
    void showEditorContextMenu({ view, readOnly: readOnly(), renderable, x: e.clientX, y: e.clientY })
      .catch((err) => console.error('[aster] context menu failed:', err));
  }

  // ── Settings backup ────────────────────────────────────────
  const settingsFilters = () => [{ name: t('dialog.settingsJson'), extensions: ['json'] }];

  async function exportSettings(): Promise<boolean> {
    const stamp = new Date().toISOString().slice(0, 10);
    const path = await saveDialog({ defaultPath: `aster-settings-${stamp}.json`, filters: settingsFilters() });
    if (!path) return false;
    const text = buildBackup(settings(), plugins().map((p) => ({ id: p.id, version: p.version })), version());
    try {
      await invoke('settings_file_write', { path, contents: text });
      flash(t('notice.exported', { name: basename(path) }));
      return true;
    } catch (e) {
      flash(t('notice.saveFailed', { err: errText(e) }), true);
      return false;
    }
  }

  async function importSettings() {
    const picked = await openDialog({ multiple: false, filters: settingsFilters() });
    if (!picked || Array.isArray(picked)) return;
    let plan;
    try {
      const text = await invoke<string>('settings_file_read', { path: picked });
      plan = planImport(text, settings(), { plugins: plugins().map((p) => p.id), themes: pluginThemes().map((th) => th.id) });
    } catch (e) {
      flash(t('notice.importFailed', { err: e instanceof BackupError ? t(e.key) : errText(e) }), true);
      return;
    }
    const lines: string[] = [];
    if (plan.changed.length) {
      lines.push(t('confirm.importChanges', { n: plan.changed.length, list: plan.changed.map((k) => t(SETTING_LABEL[k])).join('、') }));
    } else {
      lines.push(t('confirm.importNoChange'));
    }
    if (plan.dropped.length) lines.push(t('confirm.importDropped', { list: plan.dropped.join(', ') }));
    if (plan.missingTheme) lines.push(t('confirm.importTheme', { name: plan.missingTheme }));
    if (plan.missingPlugins.length) lines.push(t('confirm.importPlugins', { list: plan.missingPlugins.join(', ') }));
    if (!plan.changed.length && lines.length === 1) { flash(t('confirm.importNoChange')); return; }
    const choice = await ask(
      t('confirm.importTitle', { name: basename(picked) }),
      lines.join('\n'),
      [
        { id: 'cancel', label: t('confirm.cancel') },
        { id: 'import', label: t('confirm.import'), kind: 'primary' },
      ],
      'cancel',
    );
    if (choice !== 'import') return;
    changeSettings(plan.settings);
    flash(t('notice.imported'));
  }

  async function resetSettings() {
    const choice = await ask(
      t('confirm.resetTitle'),
      t('confirm.resetBody'),
      [
        { id: 'cancel', label: t('confirm.cancel') },
        { id: 'export', label: t('confirm.resetExportFirst') },
        { id: 'reset', label: t('confirm.reset'), kind: 'danger' },
      ],
      'cancel',
    );
    if (choice === 'cancel') return;
    if (choice === 'export' && !(await exportSettings())) return;
    changeSettings({ ...DEFAULT_SETTINGS, typography: { ...DEFAULT_SETTINGS.typography } });
    flash(t('notice.reset'));
  }

  /** Live-preview hook: render ```lang blocks through a plugin renderer, if one exists. */
  function renderCodeBlock(lang: string, body: string): Promise<string | null> | null {
    if (!asterApi) return null;
    const existing = asterApi.renderers.get(lang);
    if (existing) return existing(body);
    if (!loadable.some((p) => p.activation.includes(`onCodeBlock:${lang}`))) return null;
    return activateForTrigger(`onCodeBlock:${lang}`, loadable, pluginUrl).then(() => {
      const r = asterApi?.renderers.get(lang);
      return r ? r(body) : null;
    });
  }

  async function exportPdf() {
    try {
      await asterApi?.commands.call('pdf-export.print', {});
    } catch {
      flash(t('notice.pdfNeedsPlugin'), true);
    }
  }

  // ── Actions (menu + keyboard share one dispatcher) ─────────
  // A native menu accelerator and the webview keydown can both fire for the
  // same keystroke. Drop a menu event that arrives right after the keyboard
  // already ran that action; never throttle repeated keystrokes themselves.
  const keyRanAt = new Map<string, number>();
  function runFromMenu(action: string) {
    if (performance.now() - (keyRanAt.get(action) ?? -1e9) < 150) return;
    run(action);
  }
  function run(action: string) {
    if (confirmReq()) return;
    const editorOnly = ['save', 'saveAs', 'find', 'toggleMode', 'modeLive', 'modeSource', 'toggleLock', 'exportPdf'];
    if (onSettings() && editorOnly.includes(action)) return;
    switch (action) {
      case 'new': return newTab();
      case 'open': return void openFiles();
      case 'save': return void saveTab(activeId());
      case 'saveAs': return void saveTab(activeId(), true);
      case 'close': return void closeTab(activeId());
      case 'nextTab': return cycleTab(1);
      case 'prevTab': return cycleTab(-1);
      case 'toggleMode': return changeMode(mode() === 'live' ? 'source' : 'live');
      case 'modeLive': return changeMode('live');
      case 'modeSource': return changeMode('source');
      case 'toggleLock': return toggleLock();
      case 'settings': return openSettings();
      case 'find': if (editor) openSearchPanel(editor.view); return;
      case 'exportPdf': return void exportPdf();
      case 'quit': return void getCurrentWindow().close(); // close handler clears the snapshot
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const action = shortcutAction(e, isMac);
    if (!action) return;
    if (confirmReq()) return;
    e.preventDefault();
    e.stopPropagation();
    keyRanAt.set(action, performance.now());
    run(action);
  }

  // ── Lifecycle ──────────────────────────────────────────────
  onMount(async () => {
    editor = createEditor(host, {
      initialContent: first.content,
      mode: mode(),
      readOnly: readOnly(),
      settings: { lineNumbers: settings().lineNumbers, typewriter: settings().typewriter },
      resolveImage,
      renderCodeBlock,
      phrases: editorPhrases(lang()),
      onContentChange: (content) => {
        const id = editorDocId;
        const tb = tab(id);
        if (!tb) return;
        updateTab(id, { content, dirty: content !== tb.saved });
        if (tb.path) scheduleAutoSave(id);
        scheduleSession();
        scheduleOutline();
        noteTyping();
      },
      onSelectionChange: updateCursor,
    });
    editor.focus();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('contextmenu', onContextMenu);
    editor.view.scrollDOM.addEventListener('scroll', () => updateVisible(), { passive: true });
    window.addEventListener('mousemove', (e) => {
      // Pointer within 120px of the editor's right edge wakes the rail.
      const r = host.getBoundingClientRect();
      if (e.clientX > r.right - 120 && e.clientY > r.top && e.clientY < r.bottom) wakeRail();
    }, { passive: true });
    scheduleOutline();

    if (!inTauri) return;
    const unlisten: UnlistenFn[] = [];
    onCleanup(() => unlisten.forEach((u) => u()));

    unlisten.push(await listen<string>('aster://menu', (e) => runFromMenu(e.payload)));
    unlisten.push(await listen<{ path: string }>('aster://editor/openFile', (e) => void openPath(e.payload.path)));
    unlisten.push(await listen('aster://editor/getSelection', async () => {
      if (!editor) return;
      const s = editor.view.state.selection.main;
      await emit('aster://editor/selectionResult', {
        anchor: s.anchor, head: s.head, content: editor.view.state.sliceDoc(s.from, s.to),
      });
    }));
    unlisten.push(await listen<{ text: string; position?: number }>('aster://editor/insert', (e) => {
      if (!editor || readOnly()) return;
      const len = editor.view.state.doc.length;
      const at = Math.min(Math.max(e.payload.position ?? editor.view.state.selection.main.head, 0), len);
      editor.view.dispatch({ changes: { from: at, insert: e.payload.text }, userEvent: 'input.external' });
    }));
    unlisten.push(await getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== 'drop') return;
      for (const p of e.payload.paths) if (/\.(md|markdown|mdown|mkd|txt)$/i.test(p)) void openPath(p);
    }));

    if (inTauri) {
      try {
        interface Snap { tabs: { title: string; path: string | null; content: string; hash: string | null }[] }
        const snap = await invoke<Snap | null>('session_take');
        if (snap && snap.tabs.length > 0) {
          // A restored tab is always dirty: its saved baseline is unknown.
          const UNKNOWN = '\u0000aster:unsaved';
          const restored: Tab[] = snap.tabs.map((r) => {
            const nt = makeTab({ path: r.path, hash: r.hash }, tabs(), t('tab.untitled'));
            return { ...nt, title: r.title || nt.title, content: r.content, saved: UNKNOWN, dirty: true };
          });
          // Replace the untouched welcome tab; keep anything else.
          setTabs((ts) => [...ts.filter((tb) => !isPristine(tb)), ...restored]);
          editorDocId = '';
          setActiveId('');
          activate(restored[0].id);
          setRecoveredIds(restored.map((r) => r.id));
          void saveSession();
        }
      } catch (e) {
        console.error('[aster] session restore failed:', e);
      }
    }

    const win = getCurrentWindow();
    void getVersion().then(setVersion).catch(() => {});
    syncNativeMenu();
    if (isMac) {
      // Traffic lights disappear in fullscreen; reclaim their space.
      const syncInset = async () => setInset(!(await win.isFullscreen().catch(() => false)));
      void syncInset();
      unlisten.push(await win.onResized(() => void syncInset()));
    }
    unlisten.push(await win.onCloseRequested(async (event) => {
      const dirty = tabs().filter((tb) => tb.dirty);
      if (dirty.length === 0) {
        // Clean exit: make sure no snapshot survives to trigger recovery.
        event.preventDefault();
        await saveSession();
        await win.destroy();
        return;
      }
      event.preventDefault();
      const choice = await ask(
        dirty.length === 1 ? t('confirm.saveTitle', { name: dirty[0].title }) : t('confirm.saveManyTitle', { n: dirty.length }),
        t('confirm.saveBody'),
        [
          { id: 'discard', label: t('confirm.dontSave'), kind: 'danger' },
          { id: 'cancel', label: t('confirm.cancel') },
          { id: 'save', label: dirty.length === 1 ? t('confirm.save') : t('confirm.saveAll'), kind: 'primary' },
        ],
        'cancel',
      );
      if (choice === 'cancel') return;
      if (choice === 'save') {
        if (!(await saveAllDirty())) return;
      }
      // "Don't Save" is an explicit choice: drop the snapshot too.
      setTabs((ts) => ts.map((tb) => ({ ...tb, dirty: false })));
      await saveSession();
      await win.destroy();
    }));

    try {
      const list = await invoke<PluginInfo[]>('dispatch', { id: 'plugin.list', params: {} });
      setPlugins(list.map((p) => ({
        id: p.id, name: p.name, version: p.version, description: p.description ?? '', source: p.source, i18n: p.i18n,
      })));
      loadable = list.map((p) => ({ id: p.id, activation: p.activation, frontend: p.frontend_path ?? undefined }));
      await initPluginLoader(loadable, pluginUrl);
      if (asterApi) {
        setPluginThemes(asterApi.themes.list());
        void applySettings(settings(), pluginThemes()).then(() => editor && refreshCodeBlocks(editor.view, { clearCache: true }));
        asterApi.editor = {
          getContent: () => editor?.getContent() ?? '',
          getHtml: () => pipeline.render(editor?.getContent() ?? ''),
          getTitle: () => active()?.title ?? 'Aster',
        };
      }
    } catch (e) {
      console.error('[aster] plugin init failed:', e);
    }
    // Blocks visible at startup were drawn before plugins existed.
    if (editor) refreshCodeBlocks(editor.view);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('contextmenu', onContextMenu);
    autoSaveTimers.forEach((h) => clearTimeout(h));
    editor?.destroy();
  });

  createEffect(() => {
    const tb = active();
    if (!tb && !onSettings()) return;
    const title = tb ? `${tb.title}${tb.dirty ? ' •' : ''} — Aster` : t('window.settings');
    document.title = title;
    if (inTauri) void getCurrentWindow().setTitle(title).catch(() => {});
  });

  return (
    <div class="aster-app">
      <TabBar
        tabs={tabs()}
        activeId={activeId()}
        settingsId={settingsOpen() ? SETTINGS_ID : null}
        inset={inset()}
        onSelect={activate}
        onClose={(id) => void closeTab(id)}
        onNew={newTab}
        onOpen={() => void openFiles()}
        onSettings={openSettings}
        onExportPdf={isWindows && !onSettings() ? () => void exportPdf() : undefined}
      />
      <div class="aster-main">
        {/* The editor stays mounted while Settings is shown, so undo history,
            scroll and selection survive the round trip. */}
        <div
          class="aster-editor-host"
          ref={host}
          classList={{ 'is-readonly': readOnly() }}
          hidden={onSettings()}
        />
        <Show when={!onSettings() && settings().outlineRail && headings().length > 0}>
          <OutlineRail
            items={headings()}
            visFrom={vis().from}
            visTo={vis().to}
            cursor={cursorPos()}
            hidden={railIdle()}
            onJump={(from) => { if (editor) { revealPos(editor.view, from); updateVisible(); } }}
          />
        </Show>
        <Show when={onSettings()}>
          <SettingsPane
            settings={settings()}
            plugins={plugins()}
            themes={pluginThemes()}
            fonts={fonts()}
            version={version()}
            onChange={changeSettings}
            onExport={() => void exportSettings()}
            onImport={() => void importSettings()}
            onReset={() => void resetSettings()}
            onOpenRepo={() => { if (inTauri) void invoke('open_repo').catch((e) => flash(errText(e), true)); }}
          />
        </Show>
      </div>
      <StatusBar
        path={active()?.path ?? null}
        words={words()}
        line={cursor().line}
        col={cursor().col}
        mode={mode()}
        readOnly={readOnly()}
        notice={notice()}
        editorActive={!onSettings()}
        settingsActive={onSettings()}
        onModeChange={changeMode}
        onToggleLock={toggleLock}
        onSettings={openSettings}
        onCopyPath={() => void copyPath()}
      />
      <Show when={recoveredIds().length > 0}>
        <div class="aster-recovery" role="status">
          <span class="aster-recovery-text">{t('recovery.text', { n: recoveredIds().length })}</span>
          <button class="aster-btn" onClick={discardRecovered}>{t('recovery.discard')}</button>
          <button class="aster-btn primary" onClick={() => setRecoveredIds([])}>{t('recovery.keep')}</button>
        </div>
      </Show>
      <Show when={confirmReq()}>
        {(req) => <ConfirmModal req={req()} />}
      </Show>
    </div>
  );
}
