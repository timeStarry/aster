import { createSignal, createMemo, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getVersion } from '@tauri-apps/api/app';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { EditorState } from '@codemirror/state';
import {
  createEditor, refreshCodeBlocks, outline, visibleRange, revealPos, computeMinimalChange,
  isInsideCodeOrTableBlock, toggleInline, insertTableCmd, insertMathBlock, insertCodeBlock, insertCallout,
  type AsterEditor, type OutlineItem,
} from '@aster/editor';
import { createDefaultPipeline, buildStandaloneHtml } from '@aster/renderer';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { SettingsPane, type PluginRow, type Section as SettingsSection } from './SettingsPane';
import type { InstalledFont } from './FontCombobox';
import { ConfirmModal, type ConfirmRequest, type ConfirmButton } from './ConfirmModal';
import { SelectionBubble } from './SelectionBubble';
import { SlashMenu, type SlashTriggerState } from './SlashMenu';
import { FindBar } from './FindBar';
import { WorkspaceDrawer, type WorkspaceTreeNode, type WorkspaceSearchHit } from './WorkspaceDrawer';
import { CommandPalette, type PaletteMode, type PaletteCommand } from './CommandPalette';
import { initPluginLoader, activateForTrigger, asterApi, type LoadablePlugin } from './plugin-loader';
import {
  type Tab, type Settings, type EditorMode, type PluginTheme,
  loadSettings, saveSettings, normalizeSettings, applySettings, SETTINGS_KEY,
  makeTab, basename, dirname, wordCount, isMac, isWindows, MOD, fileUrl,
} from './model';
import { t, lang, applyLanguage, editorPhrases, WELCOME, type Lang } from './i18n';
import { showEditorContextMenu } from './contextmenu';
import { OutlineRail } from './OutlineRail';
import { shortcutAction } from './shortcuts';
import { createPlatformShell } from './platform-shell';
import {
  saveDraftOnDisk,
  deleteDraftOnDisk,
  serializeSessionState,
  loadRestoredSession,
  type DocReadResult,
  type FileChangedPayload,
} from './session-store';
import { exportSettingsFile, importSettingsFile, resetSettingsWithPrompt } from './settings-io';
import { createUpdaterController } from './updater-client';
import './theme.css';
import './platform.css';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const MD_EXTS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const RECENT_FILES_KEY = 'aster.recentFiles.v1';
const mdFilters = () => [{ name: t('dialog.markdown'), extensions: MD_EXTS }];
const pipeline = createDefaultPipeline();

interface SavedAssetDto { relPath: string; absPath: string; baseDir: string }
interface MigratedDraftDto { content: string; migratedCount: number }

function loadRecentFiles(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function persistRecentFiles(paths: string[]) {
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(paths.slice(0, 25)));
  } catch {
    /* ignore storage quota */
  }
}

interface AsterErr { code?: string; message?: string }
const errText = (e: unknown) => (e as AsterErr)?.message ?? String(e);

interface PluginInfo {
  id: string; name: string; version: string; description?: string; activation: string[];
  frontend_path: string | null; source: string;
  i18n?: Record<string, { name?: string; description?: string }>;
}

/** Base URL of Tauri's asset protocol on this platform. */
function assetBase(): string {
  try { return convertFileSrc(''); } catch { return 'asset://localhost/'; }
}

/** Normalize heading text to a GitHub-style anchor slug for `#heading` jumps. */
function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function resolveRelativePath(baseDir: string, rel: string): string {
  const sep = baseDir.includes('\\') ? '\\' : '/';
  const parts = baseDir.replace(/\\/g, '/').split('/').filter(Boolean);
  const leadingSlash = baseDir.startsWith('/');
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return (leadingSlash ? '/' : '') + parts.join(sep);
}

export default function App() {
  const [settings, setSettingsSig] = createSignal<Settings>(loadSettings());
  applyLanguage(settings().language);
  const initialAppearance = applySettings(settings());
  const shell = createPlatformShell(inTauri);
  onCleanup(() => shell.dispose());

  const welcomeText = (l: Lang) => WELCOME[l](MOD);
  const first = makeTab({ content: welcomeText(lang()) }, [], t('tab.untitled'));
  const [tabs, setTabs] = createSignal<Tab[]>([first]);
  const [activeId, setActiveId] = createSignal(first.id);
  const [mode, setMode] = createSignal<EditorMode>('live');
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>('general');
  const [workspaceRoot, setWorkspaceRoot] = createSignal<string | null>(null);
  const [workspaceTree, setWorkspaceTree] = createSignal<WorkspaceTreeNode[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = createSignal<string[]>([]);
  const [recentFiles, setRecentFiles] = createSignal<string[]>(loadRecentFiles());
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteMode, setPaletteMode] = createSignal<PaletteMode>('files');
  const [paletteFocusRev, setPaletteFocusRev] = createSignal(0);

  // Writing micro-overlays: SelectionBubble, SlashMenu, FindBar.
  const [bubbleVisible, setBubbleVisible] = createSignal(false);
  const [bubbleRev, setBubbleRev] = createSignal(0);
  const [slashTrigger, setSlashTrigger] = createSignal<SlashTriggerState | null>(null);
  const [findOpen, setFindOpen] = createSignal(false);
  const [findReplace, setFindReplace] = createSignal(false);
  const [findInitQuery, setFindInitQuery] = createSignal('');
  const [findFocusRev, setFindFocusRev] = createSignal(0);
  const [docRev, setDocRev] = createSignal(0);
  let pointerDownInEditor = false;
  let slashSessionActive = false;

  // Heading navigator & breathing status state.
  const [headings, setHeadings] = createSignal<OutlineItem[]>([]);
  const [vis, setVis] = createSignal({ from: 0, to: 0 });
  const [cursorPos, setCursorPos] = createSignal(0);
  const [railIdle, setRailIdle] = createSignal(false);
  const [typing, setTyping] = createSignal(false);
  let railTimer: number | undefined;
  let typingTimer: number | undefined;
  let outlineTimer: number | undefined;

  const [notice, setNotice] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [version, setVersion] = createSignal('');
  const [inset, setInset] = createSignal(isMac && inTauri);
  const [confirmReq, setConfirmReq] = createSignal<ConfirmRequest | null>(null);
  const [plugins, setPlugins] = createSignal<PluginRow[]>([]);
  const [pluginThemes, setPluginThemes] = createSignal<PluginTheme[]>([]);
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

  // Editor states and per-tab viewport/draft timers live outside reactive proxies.
  const states = new Map<string, EditorState>();
  const scrollTops = new Map<string, number>();
  const cursorOffsets = new Map<string, number>();
  const autoSaveTimers = new Map<string, number>();
  const draftSaveTimers = new Map<string, number>();
  const conflicted = new Set<string>();
  let editor: AsterEditor | null = null;
  let editorDocId = first.id;
  let applyingExternalSync = false;
  let host!: HTMLDivElement;
  let noticeTimer: number | undefined;

  const tab = (id: string) => tabs().find((tb) => tb.id === id);
  const active = createMemo(() => tab(activeId()));
  const forcedReadOnly = createMemo(() => !!active()?.encodingLossy);
  const effectiveReadOnly = createMemo(() => mode() === 'read' || forcedReadOnly());
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

  function isWelcomeText(content: string): boolean {
    return content === '' || content === welcomeText('en') || content === welcomeText('zh');
  }

  function isPristine(tb: Tab | undefined): boolean {
    return !!tb && !tb.path && !tb.dirty && isWelcomeText(tb.content);
  }

  // ── Tabs ───────────────────────────────────────────────────
  function activate(id: string) {
    const cur = activeId();
    if (id === cur && editor) return;
    const tb = tab(id);
    if (!tb) return;
    setActiveId(id);
    if (!editor) return;
    if (id !== editorDocId) {
      if (tab(editorDocId)) {
        states.set(editorDocId, editor.view.state);
        scrollTops.set(editorDocId, editor.view.scrollDOM.scrollTop);
        cursorOffsets.set(editorDocId, editor.view.state.selection.main.head);
      }
      editor.setState(states.get(id) ?? editor.createState(tb.content));
      editorDocId = id;
    }
    editor.setReadOnly(!!tb.encodingLossy);
    const savedScroll = scrollTops.get(id);
    if (savedScroll !== undefined) {
      editor.view.scrollDOM.scrollTop = savedScroll;
    }
    setCursorPos(editor.view.state.selection.main.head);
    setBubbleVisible(false);
    setSlashTrigger(null);
    slashSessionActive = false;
    setDocRev((r) => r + 1);
    scheduleOutline();
    scheduleSession();
    editor.view.requestMeasure();
    if (!settingsOpen()) editor.focus();
  }

  const updater = createUpdaterController({
    onBeforeRelaunch: async () => {
      await flushBeforeHotExit();
      await saveSession(true);
    },
    flash,
  });

  function openSettings(sec?: SettingsSection) {
    loadFonts();
    setSettingsSection(sec ?? (updater.hasUpdate() ? 'about' : 'general'));
    setSettingsOpen(true);
  }

  function closeSettings() {
    if (!settingsOpen()) return;
    setSettingsOpen(false);
    editor?.focus();
  }

  function toggleSettings() {
    if (settingsOpen()) closeSettings();
    else openSettings();
  }

  // ── Silent Drafts & Hot-Exit Session Store ─────────────────
  let sessionTimer: number | undefined;
  let sessionChain: Promise<void> = Promise.resolve();

  function scheduleDraftSave(id: string) {
    if (!inTauri) return;
    clearTimeout(draftSaveTimers.get(id));
    draftSaveTimers.set(id, window.setTimeout(() => void flushDraft(id), 450));
  }

  async function flushDraft(id: string): Promise<void> {
    if (!inTauri) return;
    clearTimeout(draftSaveTimers.get(id));
    draftSaveTimers.delete(id);
    const tb = tab(id);
    if (!tb || tb.path || !tb.draftId || isPristine(tb)) return;
    try {
      const dir = await saveDraftOnDisk(tb.draftId, tb.content);
      if (tb.draftDir !== dir) updateTab(id, { draftDir: dir });
    } catch (e) {
      console.error('[aster] silent draft save failed:', e);
    }
  }

  function scheduleSession() {
    if (!inTauri) return;
    clearTimeout(sessionTimer);
    sessionTimer = window.setTimeout(() => void saveSession(false), 800);
  }

  function saveSession(cleanExit = false): Promise<void> {
    if (!inTauri) return Promise.resolve();
    clearTimeout(sessionTimer);
    if (editor && tab(editorDocId)) {
      scrollTops.set(editorDocId, editor.view.scrollDOM.scrollTop);
      cursorOffsets.set(editorDocId, editor.view.state.selection.main.head);
    }
    const session = serializeSessionState({
      tabs: tabs(),
      activeId: activeId(),
      workspaceRoot: workspaceRoot(),
      cleanExit,
      isPristine,
      getState: (id) => (id === editorDocId && editor ? editor.view.state : states.get(id)),
      cursorOffsets,
      scrollTops,
    });
    sessionChain = sessionChain
      .then(() => invoke('session_save_v2', { session }))
      .then(() => {}, () => {});
    return sessionChain;
  }

  function newTab() {
    if (settingsOpen()) setSettingsOpen(false);
    const nt = makeTab({}, tabs(), t('tab.untitled'));
    setTabs((ts) => [...ts, nt]);
    activate(nt.id);
  }

  function cycleTab(dir: 1 | -1) {
    const ids = tabs().map((tb) => tb.id);
    if (ids.length <= 1) return;
    const i = ids.indexOf(activeId());
    activate(ids[(i + dir + ids.length) % ids.length]);
  }

  async function closeTab(id: string): Promise<boolean> {
    const tb = tab(id);
    if (!tb) return true;

    const isUntitledDraft = !tb.path && !isPristine(tb);
    const needsPrompt = isUntitledDraft || (tb.path !== null && tb.dirty);

    if (needsPrompt) {
      const discardLabel = isUntitledDraft ? t('confirm.deleteDraft') : t('confirm.dontSave');
      const choice = await ask(
        t('confirm.saveTitle', { name: tb.title }),
        t('confirm.saveBody'),
        [
          { id: 'discard', label: discardLabel, kind: 'danger' },
          { id: 'cancel', label: t('confirm.cancel') },
          { id: 'save', label: t('confirm.save'), kind: 'primary' },
        ],
        'cancel',
      );
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await saveTab(id))) return false;
      if (choice === 'discard' && tb.draftId) {
        await deleteDraftOnDisk(tb.draftId);
      }
    } else if (!tb.path && tb.draftId) {
      void deleteDraftOnDisk(tb.draftId);
    }

    if (tb.path && inTauri) {
      const stillOpenElsewhere = tabs().some((other) => other.id !== id && other.path === tb.path);
      if (!stillOpenElsewhere) {
        void invoke('unwatch_file', { path: tb.path }).catch(() => {});
      }
    }

    const ts = tabs();
    const idx = ts.findIndex((x) => x.id === id);
    let rest = ts.filter((x) => x.id !== id);
    states.delete(id);
    scrollTops.delete(id);
    cursorOffsets.delete(id);
    clearTimeout(autoSaveTimers.get(id));
    clearTimeout(draftSaveTimers.get(id));
    conflicted.delete(id);
    if (rest.length === 0) rest = [makeTab({}, [], t('tab.untitled'))];
    setTabs(rest);
    scheduleSession();
    const next = rest[Math.min(idx, rest.length - 1)].id;
    if (activeId() === id) {
      setActiveId('');
      activate(next);
    } else if (editorDocId === id && editor) {
      const t2 = tab(next)!;
      editor.setState(states.get(next) ?? editor.createState(t2.content));
      editor.setReadOnly(!!t2.encodingLossy);
      editorDocId = next;
    }
    return true;
  }

  // ── Files & Workspace ──────────────────────────────────────
  function recordRecentFile(path: string) {
    setRecentFiles((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, 25);
      persistRecentFiles(next);
      return next;
    });
  }

  async function refreshWorkspaceFolder() {
    if (!inTauri || !workspaceRoot()) return;
    try {
      const [treeRes, listRes] = await Promise.all([
        invoke<{ root: string; nodes: WorkspaceTreeNode[] }>('dispatch', { id: 'workspace.tree', params: {} }),
        invoke<string[]>('dispatch', { id: 'workspace.list', params: {} }),
      ]);
      setWorkspaceTree(treeRes.nodes ?? []);
      setWorkspaceFiles(listRes ?? []);
    } catch (e) {
      console.error('[aster] workspace refresh failed:', e);
    }
  }

  async function openWorkspaceFolder(explicitDir?: string, openDrawer = true) {
    if (!inTauri) return;
    let dir = explicitDir;
    if (!dir) {
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return;
      dir = picked;
    }
    try {
      const res = await invoke<{ root: string }>('dispatch', { id: 'workspace.open', params: { path: dir } });
      setWorkspaceRoot(res.root || dir);
      await refreshWorkspaceFolder();
      if (openDrawer) setSidebarOpen(true);
      scheduleSession();
    } catch (e) {
      flash(errText(e), true);
    }
  }

  async function createWorkspaceFile(relPath: string) {
    if (!inTauri || !workspaceRoot()) return;
    try {
      const res = await invoke<{ path: string }>('dispatch', { id: 'workspace.createFile', params: { relPath } });
      await refreshWorkspaceFolder();
      await openPath(res.path);
    } catch (e) {
      flash(errText(e), true);
    }
  }

  async function searchWorkspace(query: string): Promise<WorkspaceSearchHit[]> {
    if (!inTauri || !workspaceRoot()) return [];
    return invoke<WorkspaceSearchHit[]>('dispatch', {
      id: 'workspace.search',
      params: { query, maxResults: 200 },
    });
  }

  async function openPath(path: string, jumpOffset?: number) {
    if (settingsOpen()) setSettingsOpen(false);
    const jumpTo = (off?: number) => {
      if (off !== undefined && editor) {
        const clamped = Math.min(Math.max(off, 0), editor.view.state.doc.length);
        revealPos(editor.view, clamped);
        updateVisible();
      }
    };
    const existing = tabs().find((tb) => tb.path === path);
    if (existing) {
      activate(existing.id);
      recordRecentFile(path);
      jumpTo(jumpOffset);
      return;
    }
    try {
      const r = await invoke<DocReadResult>('dispatch', { id: 'doc.read', params: { path } });
      const replace = isPristine(active()) ? active()! : null;
      const nt = makeTab(
        { path, content: r.content, hash: r.hash, encodingLossy: !!r.encodingLossy },
        tabs(),
      );
      if (replace) {
        states.delete(replace.id);
        if (replace.draftId) void deleteDraftOnDisk(replace.draftId);
        setTabs((ts) => ts.map((x) => (x.id === replace.id ? nt : x)));
      } else {
        setTabs((ts) => [...ts, nt]);
      }
      activate(nt.id);
      recordRecentFile(path);
      jumpTo(jumpOffset);
      if (r.encodingLossy) {
        flash(t('notice.nonUtf8ReadOnly', { name: basename(path) }), true);
      }
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

  async function writeFile(_id: string, path: string, content: string, expectedHash?: string) {
    return invoke<{ hash: string }>('auto_save', { path, content, expectedHash });
  }

  function markSaved(id: string, path: string, content: string, hash: string) {
    const tb = tab(id);
    if (!tb) return;
    const prevDraftId = tb.draftId;
    updateTab(id, {
      path,
      draftId: null,
      draftDir: null,
      title: basename(path),
      saved: content,
      hash,
      dirty: tb.content !== content,
    });
    if (prevDraftId) void deleteDraftOnDisk(prevDraftId);
    conflicted.delete(id);
    scheduleSession();
  }

  // ── Zero-Interruption Image Asset Hosting & Migration ──────
  function insertImageMarkdownAtCursor(relPath: string, alt = '') {
    if (!editor || effectiveReadOnly()) return;
    const sel = editor.view.state.selection.main;
    const encoded = relPath.includes(' ') ? `<${relPath}>` : relPath;
    const snippet = `![${alt}](${encoded})`;
    editor.view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + snippet.length },
      userEvent: 'input.paste',
    });
  }

  async function handlePasteImage(file: File) {
    if (!inTauri || !editor || effectiveReadOnly()) return;
    const tb = active();
    if (!tb) return;
    const draftId = tb.path ? null : (tb.draftId ?? `draft-${tb.id}`);
    const assetsDir = settings().imageAssetsDir || 'assets';
    try {
      const buf = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buf));
      const ext = file.type || file.name.split('.').pop() || 'png';
      const saved = await invoke<SavedAssetDto>('asset_save_bytes', {
        docPath: tb.path,
        draftId,
        assetsDir,
        ext,
        bytes,
      });
      if (!tb.path) {
        updateTab(tb.id, { draftId, draftDir: saved.baseDir });
      }
      insertImageMarkdownAtCursor(saved.relPath);
    } catch (e) {
      flash(t('notice.imageSaveFailed', { err: errText(e) }), true);
    }
  }

  async function handleDroppedImage(sourcePath: string) {
    if (!inTauri || !editor || effectiveReadOnly()) return;
    const tb = active();
    if (!tb) return;
    const draftId = tb.path ? null : (tb.draftId ?? `draft-${tb.id}`);
    const assetsDir = settings().imageAssetsDir || 'assets';
    try {
      const saved = await invoke<SavedAssetDto>('asset_copy_file', {
        sourcePath,
        docPath: tb.path,
        draftId,
        assetsDir,
      });
      if (!tb.path) {
        updateTab(tb.id, { draftId, draftDir: saved.baseDir });
      }
      const stem = basename(sourcePath).replace(/\.[^.]+$/, '');
      insertImageMarkdownAtCursor(saved.relPath, stem);
    } catch (e) {
      flash(t('notice.imageSaveFailed', { err: errText(e) }), true);
    }
  }

  /** Save a tab. Returns false if the user cancelled or the write failed. */
  async function saveTab(id: string, saveAs = false): Promise<boolean> {
    const tb = tab(id);
    if (!tb || tb.encodingLossy) return false;
    const wasUntitledDraft = !tb.path && !!tb.draftId;
    let path = tb.path;
    if (!path || saveAs) {
      const picked = await saveDialog({ defaultPath: tb.path ?? `${tb.title}.md`, filters: mdFilters() });
      if (!picked) return false;
      path = picked;
    }
    let content = currentContent(id);
    let migratedCount = 0;
    const assetsDir = settings().imageAssetsDir || 'assets';

    if (wasUntitledDraft && tb.draftId && inTauri) {
      try {
        const mig = await invoke<MigratedDraftDto>('asset_migrate_draft', {
          draftId: tb.draftId,
          targetDocPath: path,
          assetsDir,
          content,
        });
        migratedCount = mig.migratedCount;
        if (mig.content !== content) {
          content = mig.content;
          if (id === editorDocId && editor) {
            applyingExternalSync = true;
            try {
              editor.applyExternalContent(content);
            } finally {
              applyingExternalSync = false;
            }
          } else {
            states.delete(id);
          }
          updateTab(id, { content });
        }
      } catch (e) {
        console.error('[aster] draft asset migration warning:', e);
      }
    }

    const expected = path === tb.path ? tb.hash ?? undefined : undefined;
    const finishSave = (hash: string) => {
      markSaved(id, path!, content, hash);
      recordRecentFile(path!);
      if (workspaceRoot() && path!.startsWith(workspaceRoot()!)) {
        void refreshWorkspaceFolder();
      }
      if (migratedCount > 0) {
        flash(t('notice.assetsMigrated', { name: basename(path!), n: migratedCount, dir: assetsDir }));
      } else {
        flash(t('notice.saved', { name: basename(path!) }));
      }
    };

    try {
      const r = await writeFile(id, path, content, expected);
      finishSave(r.hash);
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
        finishSave(r.hash);
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
      const r = await invoke<DocReadResult>('dispatch', { id: 'doc.read', params: { path: tb.path } });
      updateTab(id, {
        content: r.content,
        saved: r.content,
        hash: r.hash,
        dirty: false,
        encodingLossy: !!r.encodingLossy,
      });
      conflicted.delete(id);
      if (id === editorDocId && editor) {
        applyingExternalSync = true;
        try {
          editor.applyExternalContent(r.content);
        } finally {
          applyingExternalSync = false;
        }
        editor.setReadOnly(!!r.encodingLossy);
      } else {
        states.delete(id);
      }
    } catch (e) {
      flash(t('notice.reloadFailed', { err: errText(e) }), true);
    }
  }

  function handleExternalFileChange(payload: FileChangedPayload) {
    const matching = tabs().filter((tb) => tb.path === payload.path);
    for (const tb of matching) {
      if (tb.hash === payload.hash && !tb.dirty) continue;
      if (tb.dirty) {
        conflicted.add(tb.id);
        flash(t('notice.autoSavePaused', { name: tb.title }), true);
        continue;
      }
      if (tb.id === editorDocId && editor) {
        applyingExternalSync = true;
        try {
          editor.applyExternalContent(payload.content);
        } finally {
          applyingExternalSync = false;
        }
      } else {
        const prevState = states.get(tb.id);
        if (prevState) {
          const diff = computeMinimalChange(prevState.doc.toString(), payload.content);
          if (diff) {
            states.set(tb.id, prevState.update({ changes: diff, userEvent: 'input.external' }).state);
          }
        }
      }
      updateTab(tb.id, {
        content: payload.content,
        saved: payload.content,
        hash: payload.hash,
        dirty: false,
      });
      conflicted.delete(tb.id);
      flash(t('notice.externalSynced', { key: MOD }));
    }
  }

  function scheduleAutoSave(id: string) {
    clearTimeout(autoSaveTimers.get(id));
    if (!settings().autoSave || conflicted.has(id)) return;
    autoSaveTimers.set(id, window.setTimeout(async () => {
      const tb = tab(id);
      if (!tb?.path || tb.encodingLossy || !tb.dirty || conflicted.has(id)) return;
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

  /** Flush pending autoSaves (for file-backed tabs) and silent drafts before Hot Exit. */
  async function flushBeforeHotExit(): Promise<void> {
    const currentTabs = tabs();
    for (const tb of currentTabs) {
      clearTimeout(autoSaveTimers.get(tb.id));
      clearTimeout(draftSaveTimers.get(tb.id));
      const latest = currentContent(tb.id);
      if (latest !== tb.content) {
        updateTab(tb.id, { content: latest, dirty: latest !== tb.saved });
      }
      if (tb.path) {
        if (settings().autoSave && tb.dirty && !tb.encodingLossy && !conflicted.has(tb.id)) {
          try {
            const r = await writeFile(tb.id, tb.path, latest, tb.hash ?? undefined);
            updateTab(tb.id, { saved: latest, hash: r.hash, dirty: false });
          } catch {
            // SessionTab.unsavedContent preserves it safely if disk conflicted right on quit
          }
        }
      } else if (tb.draftId && !isWelcomeText(latest)) {
        try {
          await saveDraftOnDisk(tb.draftId, latest);
        } catch {
          /* best effort */
        }
      }
    }
  }

  // ── Modes, Links & Settings ────────────────────────────────
  function changeMode(m: EditorMode) {
    setMode(m);
    setBubbleVisible(false);
    setSlashTrigger(null);
    slashSessionActive = false;
    editor?.setMode(m);
    if (m !== 'read') editor?.focus();
  }

  function openFindBar(withReplace: boolean) {
    if (editor) {
      const sel = editor.view.state.selection.main;
      if (!sel.empty) {
        const picked = editor.view.state.sliceDoc(sel.from, sel.to);
        if (picked && !picked.includes('\n') && picked.length <= 120) {
          setFindInitQuery(picked);
        } else {
          setFindInitQuery('');
        }
      } else {
        setFindInitQuery('');
      }
    }
    setFindOpen(true);
    setFindReplace(withReplace && !effectiveReadOnly());
    setFindFocusRev((r) => r + 1);
  }

  function handleOpenLink(href: string) {
    const trimmed = href.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      if (!editor) return;
      const targetSlug = decodeURIComponent(trimmed.slice(1)).trim().toLowerCase();
      const found = outline(editor.view.state, 6).find(
        (h) => slugifyHeading(h.text) === targetSlug || h.text.trim().toLowerCase() === targetSlug,
      );
      if (found) {
        revealPos(editor.view, found.from);
        updateVisible();
      }
      return;
    }
    if (/^(https?:|mailto:)/i.test(trimmed)) {
      if (inTauri) {
        void invoke('open_external_url', { url: trimmed }).catch((e) => flash(errText(e), true));
      } else {
        window.open(trimmed, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    // Relative Markdown file link
    const cleanPath = trimmed.split('#')[0];
    const curPath = active()?.path;
    if (curPath && /\.(md|markdown|mdown|mkd|txt)$/i.test(cleanPath)) {
      let decoded = cleanPath;
      try { decoded = decodeURI(cleanPath); } catch { /* raw */ }
      const fullPath = decoded.startsWith('/') || /^[A-Za-z]:[\\/]/.test(decoded)
        ? decoded
        : resolveRelativePath(dirname(curPath), decoded);
      void openPath(fullPath);
    }
  }

  function syncLanguage(l: Lang) {
    editor?.setPhrases(editorPhrases(l));
    syncNativeMenu(l);
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

  function applyResolvedSettings(s: Settings, persistBackend: boolean) {
    const themeChanged = s.theme !== settings().theme;
    const langChanged = s.language !== settings().language;
    const menuChanged = s.showMenuBar !== settings().showMenuBar;
    setSettingsSig(s);
    saveSettings(s);
    if (persistBackend && inTauri) {
      void invoke('dispatch', { id: 'config.set', params: s }).catch((err) => {
        console.error('[aster] config.set failed:', err);
      });
    }
    const applied = applySettings(s, pluginThemes());
    if (themeChanged) {
      void shell.syncTheme();
      void applied.then(() => shell.syncTheme());
    }
    if (langChanged) syncLanguage(applyLanguage(s.language));
    else if (menuChanged) syncNativeMenu();
    if (themeChanged) void applied.then(() => editor && refreshCodeBlocks(editor.view, { clearCache: true }));
    editor?.setSettings({
      lineNumbers: s.lineNumbers,
      typewriter: s.typewriter,
      focusMode: s.focusMode,
      cjkSpacing: s.cjkSpacing,
    });
    editor?.view.requestMeasure();
  }

  function changeSettings(s: Settings) {
    applyResolvedSettings(s, true);
  }

  const settingsIoDeps = {
    getSettings: settings,
    getPlugins: plugins,
    getPluginThemes: pluginThemes,
    getVersion: version,
    onApply: changeSettings,
    flash,
    ask,
  };

  function scheduleOutline() {
    clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(() => {
      if (!editor) return;
      setHeadings(outline(editor.view.state, 6));
      updateVisible();
    }, 120);
  }

  function updateVisible() {
    if (!editor) return;
    setVis(visibleRange(editor.view));
  }

  function noteTyping() {
    setTyping(true);
    clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => setTyping(false), 1200);
    clearTimeout(railTimer);
    railTimer = window.setTimeout(() => setRailIdle(true), 1500);
  }

  function wakeRail() {
    clearTimeout(railTimer);
    setRailIdle(false);
  }

  function resolveImage(src: string): string {
    if (!inTauri || /^(https?:|data:|blob:|asset:)/i.test(src)) return src;
    let p = src;
    try { p = decodeURI(src); } catch { /* keep raw */ }
    if (!p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p)) {
      const cur = active();
      const baseDir = cur?.path ? dirname(cur.path) : cur?.draftDir ?? null;
      if (!baseDir) return src;
      p = `${baseDir}/${p}`;
    }
    return convertFileSrc(p);
  }

  function onContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!editor || !inTauri) return;
    if (!host.contains(target)) {
      if (!target.closest('input, textarea, [contenteditable="true"], .aster-selectable')) e.preventDefault();
      return;
    }
    e.preventDefault();
    const view = editor.view;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const sel = view.state.selection.main;
    if (pos != null && (pos < sel.from || pos > sel.to)) view.dispatch({ selection: { anchor: pos } });
    const renderable = ['math', 'mermaid'].filter((l) => loadable.some((p) => p.activation.includes(`onCodeBlock:${l}`)));
    void showEditorContextMenu({ view, readOnly: effectiveReadOnly(), renderable, x: e.clientX, y: e.clientY })
      .catch((err) => console.error('[aster] context menu failed:', err));
  }

  function renderCodeBlock(langId: string, body: string): Promise<string | null> | null {
    if (!asterApi) return null;
    const existing = asterApi.renderers.get(langId);
    if (existing) return existing(body);
    const trigger =
      loadable.some((p) => p.activation.includes(`onCodeBlock:${langId}`))
        ? `onCodeBlock:${langId}`
        : langId === 'math-inline' && loadable.some((p) => p.activation.includes('onCodeBlock:math'))
          ? 'onCodeBlock:math'
          : null;
    if (!trigger) return null;
    return activateForTrigger(trigger, loadable, pluginUrl).then(() => {
      const r = asterApi?.renderers.get(langId);
      return r ? r(body) : null;
    });
  }

  function collectPluginStylesheetLinks(): string {
    if (typeof document === 'undefined') return '';
    return Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .filter((el) => el.href && el.href.includes('katex'))
      .map((el) => `<link rel="stylesheet" href="${el.href}">`)
      .join('\n');
  }

  function exportThemeName(): 'paper' | 'light' | 'dark' | 'midnight' {
    const th = settings().theme;
    if (th === 'paper' || th === 'light' || th === 'dark' || th === 'midnight') return th;
    return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'paper';
  }

  async function renderDocumentBodyHtml(explicitMd?: string, keepRelativeImages = false): Promise<string> {
    const md = explicitMd ?? editor?.getContent() ?? active()?.content ?? '';
    return pipeline.renderAsync(md, {
      renderCodeBlock: (l, code) => renderCodeBlock(l, code) ?? null,
      resolveImage: keepRelativeImages ? undefined : resolveImage,
    });
  }

  async function buildFullExportHtml(explicitMd?: string, keepRelativeImages = false): Promise<string> {
    const bodyHtml = await renderDocumentBodyHtml(explicitMd, keepRelativeImages);
    return buildStandaloneHtml(bodyHtml, {
      title: active()?.title ?? 'Aster',
      theme: exportThemeName(),
      extraHeadHtml: keepRelativeImages ? '' : collectPluginStylesheetLinks(),
    });
  }

  async function exportHtml() {
    if (!inTauri) return;
    const tb = active();
    if (!tb) return;
    const stem = tb.title.replace(/\.[^.]+$/, '') || 'document';
    const defaultDir = tb.path ? dirname(tb.path) : undefined;
    const defaultPath = defaultDir ? `${defaultDir}/${stem}.html` : `${stem}.html`;
    const picked = await saveDialog({
      defaultPath,
      filters: [{ name: t('dialog.html'), extensions: ['html', 'htm'] }],
    });
    if (!picked) return;
    try {
      const sameDirAsDoc = !!tb.path && dirname(picked) === dirname(tb.path);
      const html = await buildFullExportHtml(undefined, sameDirAsDoc);
      await invoke('export_write_file', { path: picked, content: html });
      flash(t('notice.htmlExported', { name: basename(picked) }));
    } catch (e) {
      flash(t('notice.saveFailed', { err: errText(e) }), true);
    }
  }

  async function copyAsRichText() {
    if (!editor) return;
    const st = editor.view.state;
    const sel = st.selection.main;
    const plain = !sel.empty ? st.sliceDoc(sel.from, sel.to) : st.doc.toString();
    if (!plain.trim()) return;
    try {
      const htmlFragment = await renderDocumentBodyHtml(plain, false);
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          'text/html': new Blob([htmlFragment], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      flash(t('notice.richCopied'));
    } catch {
      flash(t('notice.copyFailed'), true);
    }
  }

  async function exportPdf() {
    try {
      await asterApi?.commands.call('pdf-export.print', {});
    } catch {
      flash(t('notice.pdfNeedsPlugin'), true);
    }
  }

  function openPalette(m: PaletteMode) {
    setBubbleVisible(false);
    setSlashTrigger(null);
    slashSessionActive = false;
    setPaletteMode(m);
    setPaletteOpen(true);
    setPaletteFocusRev((r) => r + 1);
  }

  function closePalette() {
    if (!paletteOpen()) return;
    setPaletteOpen(false);
    editor?.focus();
  }

  const paletteCommands = createMemo<PaletteCommand[]>(() => {
    void lang();
    const runEditorCmd = (fn: (view: AsterEditor['view']) => unknown) => () => {
      if (!editor || effectiveReadOnly()) return;
      fn(editor.view);
      editor.focus();
    };
    return [
      { id: 'file.new', label: t('sc.newTab'), shortcut: `${MOD}N`, keywords: ['new', 'tab', '新建'], run: newTab },
      { id: 'file.open', label: t('sc.open'), shortcut: `${MOD}O`, keywords: ['open', 'file', '打开'], run: () => void openFiles() },
      { id: 'file.openFolder', label: t('palette.cmdOpenFolder'), shortcut: `${MOD}⇧O`, keywords: ['folder', 'workspace', '文件夹'], run: () => void openWorkspaceFolder() },
      { id: 'file.quickOpen', label: t('palette.cmdQuickOpen'), shortcut: `${MOD}P`, keywords: ['quick', 'jump', '跳转'], run: () => openPalette('files') },
      { id: 'file.save', label: t('sc.save'), shortcut: `${MOD}S`, keywords: ['save', '保存'], run: () => void saveTab(activeId()) },
      { id: 'file.saveAs', label: t('sc.saveAs'), shortcut: `${MOD}⇧S`, keywords: ['save as', '另存为'], run: () => void saveTab(activeId(), true) },
      { id: 'export.html', label: t('palette.cmdExportHtml'), keywords: ['export', 'html', '导出'], run: () => void exportHtml() },
      { id: 'export.pdf', label: t('palette.cmdExportPdf'), keywords: ['export', 'pdf', 'print', '打印', '导出'], run: () => void exportPdf() },
      { id: 'edit.copyRich', label: t('palette.cmdCopyRich'), keywords: ['copy', 'rich', 'html', '富文本', '复制'], run: () => void copyAsRichText() },
      { id: 'edit.find', label: t('sc.find'), shortcut: `${MOD}F`, keywords: ['find', 'search', '查找'], run: () => openFindBar(false) },
      { id: 'view.sidebar', label: t('sidebar.toggle'), shortcut: `${MOD}\\`, keywords: ['sidebar', 'drawer', 'outline', '侧边栏', '大纲'], run: () => setSidebarOpen((v) => !v) },
      { id: 'mode.live', label: t('status.live'), keywords: ['live', 'preview', '实时'], run: () => changeMode('live') },
      { id: 'mode.source', label: t('status.source'), shortcut: `${MOD}/`, keywords: ['source', 'raw', '源码'], run: () => changeMode('source') },
      { id: 'mode.read', label: t('status.read'), keywords: ['read', 'view', '阅览'], run: () => changeMode('read') },
      { id: 'fmt.bold', label: t('sc.bold'), shortcut: `${MOD}B`, keywords: ['bold', '加粗'], run: runEditorCmd(toggleInline('**')) },
      { id: 'fmt.italic', label: t('sc.italic'), shortcut: `${MOD}I`, keywords: ['italic', '斜体'], run: runEditorCmd(toggleInline('*')) },
      { id: 'fmt.highlight', label: t('sc.highlight'), shortcut: `${MOD}⇧H`, keywords: ['highlight', 'mark', '高亮'], run: runEditorCmd(toggleInline('==')) },
      { id: 'fmt.inlineMath', label: t('sc.inlineMath'), shortcut: `${MOD}⇧M`, keywords: ['math', 'latex', '公式'], run: runEditorCmd(toggleInline('$')) },
      { id: 'ins.table', label: t('sc.table'), keywords: ['insert', 'table', '表格'], run: runEditorCmd(insertTableCmd) },
      { id: 'ins.math', label: t('ctx.mathBlock'), keywords: ['insert', 'math', 'formula', '公式块'], run: runEditorCmd(insertMathBlock) },
      { id: 'ins.code', label: t('sc.codeBlock'), keywords: ['insert', 'code', '代码块'], run: runEditorCmd(insertCodeBlock) },
      { id: 'ins.callout', label: 'Callout', keywords: ['insert', 'callout', 'note', 'tip', '提示卡片'], run: runEditorCmd((v) => insertCallout(v, 'NOTE')) },
      { id: 'theme.paper', label: t('palette.cmdThemePaper'), keywords: ['theme', 'paper', '主题', '纸白'], run: () => changeSettings({ ...settings(), theme: 'paper' }) },
      { id: 'theme.light', label: t('palette.cmdThemeLight'), keywords: ['theme', 'light', '主题', '浅色'], run: () => changeSettings({ ...settings(), theme: 'light' }) },
      { id: 'theme.dark', label: t('palette.cmdThemeDark'), keywords: ['theme', 'dark', '主题', '深墨'], run: () => changeSettings({ ...settings(), theme: 'dark' }) },
      { id: 'theme.midnight', label: t('palette.cmdThemeMidnight'), keywords: ['theme', 'midnight', 'oled', '极夜'], run: () => changeSettings({ ...settings(), theme: 'midnight' }) },
      { id: 'toggle.focus', label: t('palette.cmdToggleFocus'), keywords: ['focus', 'dim', '专注', '聚光灯'], run: () => changeSettings({ ...settings(), focusMode: !settings().focusMode }) },
      { id: 'toggle.typewriter', label: t('palette.cmdToggleTypewriter'), keywords: ['typewriter', 'scroll', '打字机'], run: () => changeSettings({ ...settings(), typewriter: !settings().typewriter }) },
      { id: 'toggle.lineNumbers', label: t('palette.cmdToggleLineNumbers'), keywords: ['line', 'numbers', '行号'], run: () => changeSettings({ ...settings(), lineNumbers: !settings().lineNumbers }) },
      { id: 'app.settings', label: t('set.title'), shortcut: `${MOD},`, keywords: ['settings', 'preferences', '设置'], run: () => openSettings() },
      { id: 'app.update', label: t('about.checkUpdate'), keywords: ['update', 'upgrade', 'release', '更新', '检查更新'], run: () => { openSettings('about'); void updater.checkForUpdates(false); } },
    ];
  });

  // ── Actions (menu + keyboard share one dispatcher) ─────────
  const keyRanAt = new Map<string, number>();
  function runFromMenu(action: string) {
    if (performance.now() - (keyRanAt.get(action) ?? -1e9) < 150) return;
    run(action);
  }
  function run(action: string) {
    if (confirmReq()) return;
    if (paletteOpen() && (action === 'quickOpen' || action === 'commandPalette')) {
      const targetMode: PaletteMode = action === 'commandPalette' ? 'commands' : 'files';
      if (paletteMode() === targetMode) {
        closePalette();
      } else {
        openPalette(targetMode);
      }
      return;
    }
    if (settingsOpen()) {
      if (action === 'close' || action === 'settings') {
        closeSettings();
        return;
      }
      const blockedInModal = [
        'save', 'saveAs', 'find', 'replace', 'toggleMode', 'modeLive', 'modeSource', 'modeRead',
        'exportHtml', 'exportPdf', 'copyRichText',
      ];
      if (blockedInModal.includes(action)) return;
    }
    switch (action) {
      case 'new': return newTab();
      case 'open': return void openFiles();
      case 'openFolder': return void openWorkspaceFolder();
      case 'quickOpen': return openPalette('files');
      case 'commandPalette': return openPalette('commands');
      case 'save': return void saveTab(activeId());
      case 'saveAs': return void saveTab(activeId(), true);
      case 'exportHtml': return void exportHtml();
      case 'exportPdf': return void exportPdf();
      case 'copyRichText': return void copyAsRichText();
      case 'close': return void closeTab(activeId());
      case 'nextTab': return cycleTab(1);
      case 'prevTab': return cycleTab(-1);
      case 'toggleSidebar': setSidebarOpen((v) => !v); return;
      case 'toggleMode': return changeMode(mode() === 'live' ? 'source' : 'live');
      case 'modeLive': return changeMode('live');
      case 'modeSource': return changeMode('source');
      case 'modeRead': return changeMode('read');
      case 'settings': return toggleSettings();
      case 'find': return openFindBar(false);
      case 'replace': return openFindBar(true);
      case 'quit': return void getCurrentWindow().close();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && settingsOpen() && !confirmReq()) {
      // Let open FontCombobox popovers handle Escape first via their own listeners if focused inside
      if (document.querySelector('.aster-combo-pop')) return;
      e.preventDefault();
      e.stopPropagation();
      closeSettings();
      return;
    }
    const action = shortcutAction(e, isMac);
    if (!action) return;
    if (confirmReq()) return;
    e.preventDefault();
    e.stopPropagation();
    keyRanAt.set(action, performance.now());
    run(action);
  }

  // ── Restore Session Helper ─────────────────────────────────
  async function restoreSessionFromDisk() {
    try {
      const restored = await loadRestoredSession({
        untitledBase: t('tab.untitled'),
        isWelcomeText,
        cursorOffsets,
        scrollTops,
      });
      if (!restored) return;

      for (const rt of restored.tabs) {
        if (editor) {
          const st = editor.createState(rt.content);
          const cur = Math.min(Math.max(cursorOffsets.get(rt.id) ?? 0, 0), st.doc.length);
          states.set(rt.id, cur > 0 ? st.update({ selection: { anchor: cur } }).state : st);
        }
      }

      setTabs((ts) => {
        const extraOpenedDuringStartup = ts.filter((tb) => !isPristine(tb));
        return [...restored.tabs, ...extraOpenedDuringStartup];
      });

      const targetId = (restored.activeId && restored.tabs.some((r) => r.id === restored.activeId))
        ? restored.activeId
        : restored.tabs[0].id;
      editorDocId = '';
      setActiveId('');
      activate(targetId);

      if (restored.workspaceRoot) {
        void openWorkspaceFolder(restored.workspaceRoot, false);
      }

      if (!restored.cleanExit && restored.tabs.some((r) => r.dirty)) {
        flash(t('notice.sessionRestored'));
      }
      void saveSession(false);
    } catch (e) {
      console.error('[aster] session restore failed:', e);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────
  onMount(async () => {
    shell.mount();
    void initialAppearance.then(() => shell.syncTheme());
    editor = createEditor(host, {
      initialContent: first.content,
      mode: mode(),
      readOnly: forcedReadOnly(),
      settings: {
        lineNumbers: settings().lineNumbers,
        typewriter: settings().typewriter,
        focusMode: settings().focusMode,
        cjkSpacing: settings().cjkSpacing,
      },
      resolveImage,
      renderCodeBlock,
      onOpenLink: handleOpenLink,
      onPasteImage: (file) => handlePasteImage(file),
      phrases: editorPhrases(lang()),
      onContentChange: (content) => {
        setDocRev((r) => r + 1);
        setBubbleVisible(false);
        if (editor && settings().slashCommands && !effectiveReadOnly() && !settingsOpen()) {
          const st = editor.view.state;
          const sel = st.selection.main;
          if (sel.empty && !isInsideCodeOrTableBlock(st, sel.head)) {
            const line = st.doc.lineAt(sel.head);
            const before = line.text.slice(0, sel.head - line.from);
            const after = line.text.slice(sel.head - line.from);
            if (before === '/' && after.trim() === '') slashSessionActive = true;
            if (slashSessionActive) {
              const m = before.match(/^\/([a-zA-Z0-9\u4e00-\u9fa5_-]{0,16})$/);
              if (m && after.trim() === '') {
                setSlashTrigger({ lineFrom: line.from, lineTo: line.to, query: m[1] });
              } else {
                slashSessionActive = false;
                setSlashTrigger(null);
              }
            }
          } else {
            slashSessionActive = false;
            setSlashTrigger(null);
          }
        } else {
          slashSessionActive = false;
          setSlashTrigger(null);
        }

        if (applyingExternalSync) return;
        const id = editorDocId;
        const tb = tab(id);
        if (!tb) return;
        const isDirty = tb.path ? content !== tb.saved : !isWelcomeText(content);
        updateTab(id, { content, dirty: isDirty });
        if (tb.path) scheduleAutoSave(id);
        else scheduleDraftSave(id);
        scheduleSession();
        scheduleOutline();
        noteTyping();
      },
      onSelectionChange: (st) => {
        const head = st.selection.main.head;
        cursorOffsets.set(editorDocId, head);
        setCursorPos(head);
        setDocRev((r) => r + 1);
        if (st.selection.main.empty) setBubbleVisible(false);
        const trig = slashTrigger();
        if (trig) {
          const line = st.doc.lineAt(head);
          if (!st.selection.main.empty || line.from !== trig.lineFrom) {
            slashSessionActive = false;
            setSlashTrigger(null);
          }
        }
      },
    });
    editor.focus();

    const onHostMouseDown = () => {
      pointerDownInEditor = true;
      setBubbleVisible(false);
    };
    const onWindowMouseUp = () => {
      if (!pointerDownInEditor) return;
      pointerDownInEditor = false;
      queueMicrotask(() => {
        if (!editor || effectiveReadOnly() || settingsOpen()) {
          setBubbleVisible(false);
          return;
        }
        const st = editor.view.state;
        const sel = st.selection.main;
        if (
          !sel.empty &&
          st.selection.ranges.length === 1 &&
          !(mode() === 'live' && isInsideCodeOrTableBlock(st, sel.from))
        ) {
          setBubbleRev((r) => r + 1);
          setBubbleVisible(true);
        } else {
          setBubbleVisible(false);
        }
      });
    };
    host.addEventListener('mousedown', onHostMouseDown);
    window.addEventListener('mouseup', onWindowMouseUp);
    onCleanup(() => {
      host.removeEventListener('mousedown', onHostMouseDown);
      window.removeEventListener('mouseup', onWindowMouseUp);
    });

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('contextmenu', onContextMenu);
    editor.view.scrollDOM.addEventListener('scroll', () => {
      if (editor) scrollTops.set(editorDocId, editor.view.scrollDOM.scrollTop);
      setBubbleVisible(false);
      updateVisible();
    }, { passive: true });
    window.addEventListener('mousemove', (e) => {
      if (typing()) setTyping(false);
      const r = host.getBoundingClientRect();
      if (e.clientX > r.right - 120 && e.clientY > r.top && e.clientY < r.bottom) wakeRail();
    }, { passive: true });
    scheduleOutline();

    if (!inTauri) return;
    const unlisten: UnlistenFn[] = [];
    onCleanup(() => unlisten.forEach((u) => u()));

    // Sync unified ~/.aster/config.json (migrating existing localStorage settings on first run)
    try {
      const diskCfg = await invoke<Record<string, unknown>>('dispatch', { id: 'config.get', params: {} });
      if (diskCfg && diskCfg.existsOnDisk === false && localStorage.getItem(SETTINGS_KEY)) {
        await invoke('dispatch', { id: 'config.set', params: settings() });
      } else if (diskCfg) {
        applyResolvedSettings(normalizeSettings(diskCfg), false);
      }
    } catch (e) {
      console.error('[aster] config.get failed:', e);
    }

    unlisten.push(await listen<string>('aster://menu', (e) => runFromMenu(e.payload)));
    unlisten.push(await listen<{ path: string }>('aster://editor/openFile', (e) => void openPath(e.payload.path)));
    unlisten.push(await listen<FileChangedPayload>('aster://file/changed', (e) => handleExternalFileChange(e.payload)));
    unlisten.push(await listen('aster://editor/getSelection', async () => {
      if (!editor) return;
      const s = editor.view.state.selection.main;
      await emit('aster://editor/selectionResult', {
        anchor: s.anchor, head: s.head, content: editor.view.state.sliceDoc(s.from, s.to),
      });
    }));
    unlisten.push(await listen<{ text: string; position?: number }>('aster://editor/insert', (e) => {
      if (!editor || effectiveReadOnly()) return;
      const len = editor.view.state.doc.length;
      const at = Math.min(Math.max(e.payload.position ?? editor.view.state.selection.main.head, 0), len);
      editor.view.dispatch({ changes: { from: at, insert: e.payload.text }, userEvent: 'input.external' });
    }));
    unlisten.push(await getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== 'drop') return;
      for (const p of e.payload.paths) {
        if (/\.(md|markdown|mdown|mkd|txt)$/i.test(p)) void openPath(p);
        else if (IMG_EXT_RE.test(p)) void handleDroppedImage(p);
      }
    }));

    await restoreSessionFromDisk();
    const startupFiles = await invoke<string[]>('take_startup_files').catch(() => []);
    for (const p of startupFiles) await openPath(p);

    const win = getCurrentWindow();
    void win.isFocused().then((isActive) => shell.setWindowActive(isActive)).catch(() => {});
    unlisten.push(await win.onFocusChanged(({ payload }) => shell.setWindowActive(payload)).catch(() => () => {}));
    void getVersion().then(setVersion).catch(() => {});
    syncNativeMenu();
    if (isMac) {
      const syncInset = async () => setInset(!(await win.isFullscreen().catch(() => false)));
      void syncInset();
      unlisten.push(await win.onResized(() => void syncInset()));
    }

    // Hot Exit: normal window close / ⌘Q silently flushes files & drafts and exits without nagging.
    unlisten.push(await win.onCloseRequested(async (event) => {
      event.preventDefault();
      await flushBeforeHotExit();
      await saveSession(true);
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
        const applied = applySettings(settings(), pluginThemes());
        void shell.syncTheme();
        void applied.then(() => {
          void shell.syncTheme();
          if (editor) refreshCodeBlocks(editor.view, { clearCache: true });
        });
        asterApi.editor = {
          getContent: () => editor?.getContent() ?? '',
          getHtml: () => pipeline.render(editor?.getContent() ?? '', { resolveImage }),
          getHtmlAsync: () => renderDocumentBodyHtml(undefined, false),
          getStandaloneHtml: (explicitMd?: string) => buildFullExportHtml(explicitMd, false),
          getTitle: () => active()?.title ?? 'Aster',
        };
      }
    } catch (e) {
      console.error('[aster] plugin init failed:', e);
    }
    if (editor) refreshCodeBlocks(editor.view);

    // Silent background GitHub Releases check on startup when enabled.
    if (settings().updateCheckEnabled) {
      const updateTimer = window.setTimeout(() => {
        void updater.checkForUpdates(true);
      }, 2500);
      unlisten.push(() => clearTimeout(updateTimer));
    }
  });

  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('contextmenu', onContextMenu);
    clearTimeout(typingTimer);
    clearTimeout(railTimer);
    clearTimeout(outlineTimer);
    autoSaveTimers.forEach((h) => clearTimeout(h));
    draftSaveTimers.forEach((h) => clearTimeout(h));
    editor?.destroy();
  });

  createEffect(() => {
    const tb = active();
    if (!tb) return;
    // Untitled silent drafts don't clutter window title with anxious dirty bullet; file-backed dirty tabs do.
    const showDot = tb.path && tb.dirty;
    const title = `${tb.title}${showDot ? ' •' : ''} — Aster`;
    document.title = title;
    if (inTauri) void getCurrentWindow().setTitle(title).catch(() => {});
  });

  return (
    <div class="aster-app">
      <TabBar
        tabs={tabs()}
        activeId={activeId()}
        inset={inset()}
        sidebarOpen={sidebarOpen()}
        settingsOpen={settingsOpen()}
        hasUpdate={updater.hasUpdate()}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onSelect={activate}
        onClose={(id) => void closeTab(id)}
        onNew={newTab}
        onOpen={() => void openFiles()}
        onSettings={toggleSettings}
        onExportPdf={isWindows ? () => void exportPdf() : undefined}
      />
      <div class="aster-main">
        <WorkspaceDrawer
          open={sidebarOpen()}
          workspaceRoot={workspaceRoot()}
          tree={workspaceTree()}
          activePath={active()?.path ?? null}
          headings={headings()}
          cursorPos={cursorPos()}
          onOpenFolder={() => void openWorkspaceFolder()}
          onRefreshFolder={() => void refreshWorkspaceFolder()}
          onCreateFile={(rel) => createWorkspaceFile(rel)}
          onSelectFile={(path, offset) => void openPath(path, offset)}
          onJumpHeading={(from) => { if (editor) { revealPos(editor.view, from); updateVisible(); editor.focus(); } }}
          onSearchWorkspace={searchWorkspace}
        />
        <div
          class="aster-editor-host"
          ref={host}
          classList={{ 'is-readonly': effectiveReadOnly() }}
        />
        <SelectionBubble
          view={() => editor?.view ?? null}
          visible={bubbleVisible() && !effectiveReadOnly() && !settingsOpen()}
          rev={bubbleRev()}
          onDismiss={() => setBubbleVisible(false)}
        />
        <SlashMenu
          view={() => editor?.view ?? null}
          trigger={settings().slashCommands && !effectiveReadOnly() && !settingsOpen() ? slashTrigger() : null}
          onClose={() => {
            slashSessionActive = false;
            setSlashTrigger(null);
          }}
        />
        <FindBar
          open={findOpen()}
          showReplace={findReplace()}
          readOnly={effectiveReadOnly()}
          initialQuery={findInitQuery()}
          docRev={docRev()}
          focusRev={findFocusRev()}
          view={() => editor?.view ?? null}
          onToggleReplace={setFindReplace}
          onClose={() => setFindOpen(false)}
        />
        <Show when={settings().outlineRail && headings().length > 0}>
          <OutlineRail
            items={headings()}
            visFrom={vis().from}
            visTo={vis().to}
            cursor={cursorPos()}
            hidden={railIdle()}
            onJump={(from) => { if (editor) { revealPos(editor.view, from); updateVisible(); } }}
          />
        </Show>
      </div>
      <StatusBar
        words={words()}
        mode={mode()}
        encodingLossy={forcedReadOnly()}
        typing={typing()}
        notice={notice()}
        onModeChange={changeMode}
      />
      <Show when={settingsOpen()}>
        <div
          class="aster-settings-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t('set.title')}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSettings();
          }}
        >
          <div class="aster-settings-sheet">
            <SettingsPane
              settings={settings()}
              plugins={plugins()}
              themes={pluginThemes()}
              fonts={fonts()}
              version={version()}
              updater={updater}
              initialSection={settingsSection()}
              onChange={changeSettings}
              onExport={() => void exportSettingsFile(settingsIoDeps)}
              onImport={() => void importSettingsFile(settingsIoDeps)}
              onReset={() => void resetSettingsWithPrompt(settingsIoDeps)}
              onOpenRepo={() => { if (inTauri) void invoke('open_repo').catch((e) => flash(errText(e), true)); }}
              onClose={closeSettings}
            />
          </div>
        </div>
      </Show>
      <CommandPalette
        open={paletteOpen()}
        mode={paletteMode()}
        focusRev={paletteFocusRev()}
        tabs={tabs()}
        recentFiles={recentFiles()}
        workspaceRoot={workspaceRoot()}
        workspaceFiles={workspaceFiles()}
        commands={paletteCommands()}
        onSelectTab={activate}
        onOpenPath={(path) => void openPath(path)}
        onClose={closePalette}
      />
      <Show when={confirmReq()}>
        {(req) => <ConfirmModal req={req()} />}
      </Show>
    </div>
  );
}
