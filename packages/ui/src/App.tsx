import { createSignal, createMemo, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { EditorState } from '@codemirror/state';
import { createEditor, openSearchPanel, type AsterEditor } from '@aster/editor';
import { createDefaultPipeline } from '@aster/renderer';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { SettingsModal, type PluginRow } from './SettingsModal';
import { ConfirmModal, type ConfirmRequest, type ConfirmButton } from './ConfirmModal';
import { initPluginLoader, asterApi } from './plugin-loader';
import {
  type Tab, type Settings, type EditorMode,
  loadSettings, saveSettings, applySettings, makeTab, basename, dirname, wordCount, isMac, WELCOME,
} from './model';
import './theme.css';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }];
const pipeline = createDefaultPipeline();

interface AsterErr { code?: string; message?: string }
const errText = (e: unknown) => (e as AsterErr)?.message ?? String(e);

interface PluginInfo {
  id: string; name: string; version: string; activation: string[];
  frontend_path: string | null; source: string;
}

export default function App() {
  const [settings, setSettingsSig] = createSignal<Settings>(loadSettings());
  applySettings(settings());

  const first = makeTab({ content: WELCOME }, []);
  const [tabs, setTabs] = createSignal<Tab[]>([first]);
  const [activeId, setActiveId] = createSignal(first.id);
  const [mode, setMode] = createSignal<EditorMode>('live');
  const [readOnly, setReadOnly] = createSignal(false);
  const [cursor, setCursor] = createSignal({ line: 1, col: 1 });
  const [notice, setNotice] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [showSettings, setShowSettings] = createSignal(false);
  const [confirmReq, setConfirmReq] = createSignal<ConfirmRequest | null>(null);
  const [plugins, setPlugins] = createSignal<PluginRow[]>([]);

  // Editor states are kept outside the reactive graph: Solid must not proxy them.
  const states = new Map<string, EditorState>();
  const autoSaveTimers = new Map<string, number>();
  const conflicted = new Set<string>();
  let editor: AsterEditor | null = null;
  let host!: HTMLDivElement;
  let noticeTimer: number | undefined;

  const tab = (id: string) => tabs().find((t) => t.id === id);
  const active = createMemo(() => tab(activeId()));
  const words = createMemo(() => wordCount(active()?.content ?? ''));
  const updateTab = (id: string, patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

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
    if (editor && cur && tab(cur)) states.set(cur, editor.view.state);
    setActiveId(id);
    const t = tab(id);
    if (!editor || !t) return;
    editor.setState(states.get(id) ?? editor.createState(t.content));
    updateCursor(editor.view.state);
    editor.focus();
  }

  function newTab() {
    const t = makeTab({}, tabs());
    setTabs((ts) => [...ts, t]);
    activate(t.id);
  }

  function cycleTab(dir: 1 | -1) {
    const ts = tabs();
    const i = ts.findIndex((t) => t.id === activeId());
    activate(ts[(i + dir + ts.length) % ts.length].id);
  }

  async function closeTab(id: string): Promise<boolean> {
    const t = tab(id);
    if (!t) return true;
    if (t.dirty) {
      const choice = await ask(
        `Save changes to “${t.title}”?`,
        "Your changes will be lost if you don't save them.",
        [
          { id: 'discard', label: "Don't Save", kind: 'danger' },
          { id: 'cancel', label: 'Cancel' },
          { id: 'save', label: 'Save', kind: 'primary' },
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
    if (rest.length === 0) rest = [makeTab({}, [])];
    setTabs(rest);
    if (activeId() === id) {
      setActiveId('');
      activate(rest[Math.min(idx, rest.length - 1)].id);
    }
    return true;
  }

  // ── Files ──────────────────────────────────────────────────
  function isPristine(t: Tab | undefined) {
    return !!t && !t.path && !t.dirty && (t.content === '' || t.content === WELCOME);
  }

  async function openPath(path: string) {
    const existing = tabs().find((t) => t.path === path);
    if (existing) { activate(existing.id); return; }
    try {
      const r = await invoke<{ content: string; hash: string }>('dispatch', { id: 'doc.read', params: { path } });
      const replace = isPristine(active()) ? active()! : null;
      const t = makeTab({ path, content: r.content, hash: r.hash }, tabs());
      if (replace) {
        states.delete(replace.id);
        setTabs((ts) => ts.map((x) => (x.id === replace.id ? t : x)));
      } else {
        setTabs((ts) => [...ts, t]);
      }
      activate(t.id);
    } catch (e) {
      flash(`Could not open ${basename(path)}: ${errText(e)}`, true);
    }
  }

  async function openFiles() {
    const picked = await openDialog({ multiple: true, filters: MD_FILTERS });
    if (!picked) return;
    for (const p of Array.isArray(picked) ? picked : [picked]) await openPath(p);
  }

  function currentContent(id: string): string {
    return id === activeId() && editor ? editor.getContent() : tab(id)?.content ?? '';
  }

  async function writeFile(id: string, path: string, content: string, expectedHash?: string) {
    return invoke<{ hash: string }>('auto_save', { path, content, expectedHash });
  }

  function markSaved(id: string, path: string, content: string, hash: string) {
    const t = tab(id);
    if (!t) return;
    updateTab(id, { path, title: basename(path), saved: content, hash, dirty: t.content !== content });
    conflicted.delete(id);
  }

  /** Save a tab. Returns false if the user cancelled or the write failed. */
  async function saveTab(id: string, saveAs = false): Promise<boolean> {
    const t = tab(id);
    if (!t) return false;
    let path = t.path;
    if (!path || saveAs) {
      const picked = await saveDialog({ defaultPath: t.path ?? `${t.title}.md`, filters: MD_FILTERS });
      if (!picked) return false;
      path = picked;
    }
    const content = currentContent(id);
    const expected = path === t.path ? t.hash ?? undefined : undefined;
    try {
      const r = await writeFile(id, path, content, expected);
      markSaved(id, path, content, r.hash);
      flash(`Saved ${basename(path)}`);
      return true;
    } catch (e) {
      if ((e as AsterErr)?.code !== 'E_CONFLICT') {
        flash(`Save failed: ${errText(e)}`, true);
        return false;
      }
      const choice = await ask(
        `“${basename(path)}” changed on disk`,
        'Another program modified this file after it was opened. Overwrite it with your version, or reload the version on disk?',
        [
          { id: 'reload', label: 'Reload from Disk', kind: 'danger' },
          { id: 'cancel', label: 'Cancel' },
          { id: 'overwrite', label: 'Overwrite', kind: 'primary' },
        ],
        'cancel',
      );
      if (choice === 'cancel') return false;
      if (choice === 'reload') { await reloadTab(id); return false; }
      try {
        const r = await writeFile(id, path, content);
        markSaved(id, path, content, r.hash);
        flash(`Saved ${basename(path)}`);
        return true;
      } catch (e2) {
        flash(`Save failed: ${errText(e2)}`, true);
        return false;
      }
    }
  }

  async function reloadTab(id: string) {
    const t = tab(id);
    if (!t?.path) return;
    try {
      const r = await invoke<{ content: string; hash: string }>('dispatch', { id: 'doc.read', params: { path: t.path } });
      updateTab(id, { content: r.content, saved: r.content, hash: r.hash, dirty: false });
      conflicted.delete(id);
      states.delete(id);
      if (id === activeId() && editor) editor.setState(editor.createState(r.content));
    } catch (e) {
      flash(`Reload failed: ${errText(e)}`, true);
    }
  }

  function scheduleAutoSave(id: string) {
    clearTimeout(autoSaveTimers.get(id));
    if (!settings().autoSave || conflicted.has(id)) return;
    autoSaveTimers.set(id, window.setTimeout(async () => {
      const t = tab(id);
      if (!t?.path || !t.dirty || conflicted.has(id)) return;
      const content = t.content;
      try {
        const r = await writeFile(id, t.path, content, t.hash ?? undefined);
        markSaved(id, t.path, content, r.hash);
      } catch (e) {
        if ((e as AsterErr)?.code === 'E_CONFLICT') {
          conflicted.add(id);
          flash(`“${t.title}” changed on disk — auto-save paused. Save manually to resolve.`, true);
        } else {
          flash(`Auto-save failed: ${errText(e)}`, true);
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
    flash(on ? 'Read-only — editing is locked' : 'Editing unlocked');
  }

  function changeSettings(s: Settings) {
    setSettingsSig(s);
    saveSettings(s);
    applySettings(s);
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

  async function exportPdf() {
    try {
      await asterApi?.commands.call('pdf-export.print', {});
    } catch {
      flash('PDF export needs the PDF Export plugin (included in the full edition).', true);
    }
  }

  // ── Actions (menu + keyboard share one dispatcher) ─────────
  const lastRun = new Map<string, number>();
  function run(action: string) {
    // A native menu accelerator and the webview keydown can both fire for the
    // same keystroke on some platforms; collapse duplicates.
    const now = performance.now();
    if (now - (lastRun.get(action) ?? -1e9) < 150) return;
    lastRun.set(action, now);
    if (confirmReq()) return;
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
      case 'settings': return setShowSettings((v) => !v);
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
    if ((showSettings() || confirmReq()) && action !== 'settings') return;
    e.preventDefault();
    e.stopPropagation();
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
      onContentChange: (content) => {
        const id = activeId();
        const t = tab(id);
        if (!t) return;
        updateTab(id, { content, dirty: content !== t.saved });
        if (t.path) scheduleAutoSave(id);
      },
      onSelectionChange: updateCursor,
    });
    editor.focus();
    window.addEventListener('keydown', onKeyDown, true);

    if (!inTauri) return;
    const unlisten: UnlistenFn[] = [];
    onCleanup(() => unlisten.forEach((u) => u()));

    unlisten.push(await listen<string>('aster://menu', (e) => run(e.payload)));
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
    unlisten.push(await win.onCloseRequested(async (event) => {
      const dirty = tabs().filter((t) => t.dirty);
      if (dirty.length === 0) return;
      event.preventDefault();
      const choice = await ask(
        dirty.length === 1 ? `Save changes to “${dirty[0].title}”?` : `${dirty.length} documents have unsaved changes`,
        "Your changes will be lost if you don't save them.",
        [
          { id: 'discard', label: "Don't Save", kind: 'danger' },
          { id: 'cancel', label: 'Cancel' },
          { id: 'save', label: dirty.length === 1 ? 'Save' : 'Save All', kind: 'primary' },
        ],
        'cancel',
      );
      if (choice === 'cancel') return;
      if (choice === 'save') {
        for (const t of dirty) {
          activate(t.id);
          if (!(await saveTab(t.id))) return;
        }
      }
      await win.destroy();
    }));

    try {
      const list = await invoke<PluginInfo[]>('dispatch', { id: 'plugin.list', params: {} });
      setPlugins(list.map((p) => ({ id: p.id, name: p.name, version: p.version, source: p.source })));
      await initPluginLoader(
        list.map((p) => ({ id: p.id, activation: p.activation, frontend: p.frontend_path ?? undefined })),
        (_id, path) => convertFileSrc(path),
      );
      if (asterApi) {
        asterApi.editor = {
          getContent: () => editor?.getContent() ?? '',
          getHtml: () => pipeline.render(editor?.getContent() ?? ''),
          getTitle: () => active()?.title ?? 'Aster',
        };
      }
    } catch (e) {
      console.error('[aster] plugin init failed:', e);
    }
  });

  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    autoSaveTimers.forEach((t) => clearTimeout(t));
    editor?.destroy();
  });

  createEffect(() => {
    const t = active();
    if (!t) return;
    const title = `${t.title}${t.dirty ? ' •' : ''} — Aster`;
    document.title = title;
    if (inTauri) void getCurrentWindow().setTitle(title).catch(() => {});
  });

  return (
    <div class="aster-app">
      <TabBar
        tabs={tabs()}
        activeId={activeId()}
        onSelect={activate}
        onClose={(id) => void closeTab(id)}
        onNew={newTab}
      />
      <div class="aster-editor-host" ref={host} classList={{ 'is-readonly': readOnly() }} />
      <StatusBar
        path={active()?.path ?? null}
        words={words()}
        line={cursor().line}
        col={cursor().col}
        mode={mode()}
        readOnly={readOnly()}
        notice={notice()}
        onModeChange={changeMode}
        onToggleLock={toggleLock}
        onSettings={() => setShowSettings(true)}
      />
      <Show when={showSettings()}>
        <SettingsModal
          settings={settings()}
          plugins={plugins()}
          onChange={changeSettings}
          onClose={() => { setShowSettings(false); editor?.focus(); }}
        />
      </Show>
      <Show when={confirmReq()}>
        {(req) => <ConfirmModal req={req()} />}
      </Show>
    </div>
  );
}
