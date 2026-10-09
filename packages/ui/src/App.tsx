import { createSignal, createMemo, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getVersion } from '@tauri-apps/api/app';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { EditorState } from '@codemirror/state';
import { createEditor, openSearchPanel, refreshCodeBlocks, type AsterEditor } from '@aster/editor';
import { createDefaultPipeline } from '@aster/renderer';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { SettingsPane, type PluginRow } from './SettingsPane';
import { ConfirmModal, type ConfirmRequest, type ConfirmButton } from './ConfirmModal';
import { initPluginLoader, activateForTrigger, asterApi, type LoadablePlugin } from './plugin-loader';
import {
  type Tab, type Settings, type EditorMode, type PluginTheme,
  loadSettings, saveSettings, applySettings, makeTab, basename, dirname, wordCount, isMac, MOD, fileUrl,
} from './model';
import { t, lang, applyLanguage, editorPhrases, WELCOME, type Lang } from './i18n';
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
  const [notice, setNotice] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [version, setVersion] = createSignal('');
  const [inset, setInset] = createSignal(isMac && inTauri);
  const [confirmReq, setConfirmReq] = createSignal<ConfirmRequest | null>(null);
  const [plugins, setPlugins] = createSignal<PluginRow[]>([]);
  const [pluginThemes, setPluginThemes] = createSignal<PluginTheme[]>([]);
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
    // The editor was hidden while Settings was shown; re-measure before focusing.
    editor.view.requestMeasure();
    editor.focus();
  }

  /** Settings is a singleton tab: open it, or focus it if already open. */
  function openSettings() {
    setSettingsOpen(true);
    activate(SETTINGS_ID);
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
    if (inTauri) void invoke('set_menu_language', { lang: l }).catch(() => {});
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

  function changeSettings(s: Settings) {
    const themeChanged = s.theme !== settings().theme;
    const langChanged = s.language !== settings().language;
    setSettingsSig(s);
    saveSettings(s);
    applySettings(s, pluginThemes());
    if (langChanged) syncLanguage(applyLanguage(s.language));
    // Diagrams pick colors from the theme at render time.
    if (themeChanged && editor) requestAnimationFrame(() => editor && refreshCodeBlocks(editor.view, { clearCache: true }));
    editor?.setSettings({ lineNumbers: s.lineNumbers, typewriter: s.typewriter });
    editor?.view.requestMeasure();
  }

  function updateCursor(state: EditorState) {
    const head = state.selection.main.head;
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
      case 'quit': return void getCurrentWindow().close();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    let action: string | null = null;
    if (e.ctrlKey && e.code === 'Tab') action = e.shiftKey ? 'prevTab' : 'nextTab';
    else if (mod && !e.altKey) {
      switch (e.code) {
        case 'KeyN': action = 'new'; break;
        case 'KeyO': action = 'open'; break;
        case 'KeyS': action = e.shiftKey ? 'saveAs' : 'save'; break;
        case 'KeyW': action = 'close'; break;
        case 'Slash': action = 'toggleMode'; break;
        case 'Comma': action = 'settings'; break;
        case 'KeyF': action = 'find'; break;
      }
    } else if (mod && e.altKey && e.code === 'KeyL') action = 'toggleLock';
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
      },
      onSelectionChange: updateCursor,
    });
    editor.focus();
    window.addEventListener('keydown', onKeyDown, true);

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

    const win = getCurrentWindow();
    void getVersion().then(setVersion).catch(() => {});
    void invoke('set_menu_language', { lang: lang() }).catch(() => {});
    if (isMac) {
      // Traffic lights disappear in fullscreen; reclaim their space.
      const syncInset = async () => setInset(!(await win.isFullscreen().catch(() => false)));
      void syncInset();
      unlisten.push(await win.onResized(() => void syncInset()));
    }
    unlisten.push(await win.onCloseRequested(async (event) => {
      const dirty = tabs().filter((tb) => tb.dirty);
      if (dirty.length === 0) return;
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
        for (const tb of dirty) {
          activate(tb.id);
          if (!(await saveTab(tb.id))) return;
        }
      }
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
        applySettings(settings(), pluginThemes());
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
        <Show when={onSettings()}>
          <SettingsPane
            settings={settings()}
            plugins={plugins()}
            themes={pluginThemes()}
            version={version()}
            onChange={changeSettings}
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
      />
      <Show when={confirmReq()}>
        {(req) => <ConfirmModal req={req()} />}
      </Show>
    </div>
  );
}
