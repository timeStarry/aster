export type EditorMode = 'live' | 'source';

export interface Tab {
  id: string;
  /** Absolute path, or null for an unsaved buffer. */
  path: string | null;
  title: string;
  content: string;
  /** Content as last loaded/saved; dirty = content !== saved. */
  saved: string;
  /** Hash of the last successful save, used as an optimistic lock. */
  hash: string | null;
  dirty: boolean;
}

export interface Settings {
  /** 'system' | 'light' | 'dark', or a plugin theme id. */
  theme: string;
  fontSize: number;
  proseWidth: number;
  lineNumbers: boolean;
  typewriter: boolean;
  autoSave: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontSize: 16,
  proseWidth: 760,
  lineNumbers: false,
  typewriter: false,
  autoSave: true,
};

export const SETTINGS_KEY = 'aster.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export interface PluginTheme { id: string; name: string; cssFile: string }

export function applySettings(s: Settings, pluginThemes: PluginTheme[] = []): void {
  const root = document.documentElement;
  const pt = pluginThemes.find((t) => t.id === s.theme);
  let link = document.getElementById('aster-plugin-theme') as HTMLLinkElement | null;
  if (pt) {
    if (!link) {
      link = document.createElement('link');
      link.id = 'aster-plugin-theme';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== pt.cssFile) link.href = pt.cssFile;
  } else {
    link?.remove();
  }
  // A plugin theme id that isn't loaded (yet) falls back to the system theme.
  if (s.theme === 'system' || (!pt && s.theme !== 'light' && s.theme !== 'dark')) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  root.style.setProperty('--editor-font-size', `${s.fontSize}px`);
  root.style.setProperty('--prose-width', `${s.proseWidth}px`);
}

export function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';
export const ALT = isMac ? '⌥' : 'Alt+';
export const SHIFT = isMac ? '⇧' : 'Shift+';

let seq = 1;
export function newTabId(): string {
  return `t${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export function untitledTitle(existing: Tab[]): string {
  const used = new Set(existing.filter((t) => !t.path).map((t) => t.title));
  if (!used.has('Untitled')) return 'Untitled';
  for (let n = 2; n < 100; n++) {
    const t = `Untitled ${n}`;
    if (!used.has(t)) return t;
  }
  return `Untitled ${Date.now()}`;
}

export const WELCOME = `# Welcome to Aster

Start writing. Live preview hides the markup as you leave a line.

**Bold** with ⌘B, *italic* with ⌘I, \`code\` with ⌘E, [links](url) with ⌘K.

- Lists continue on Enter
- [ ] Tasks toggle with a click
- Headings: ⌘1 – ⌘6

Open a file with ⌘O, save with ⌘S, new tab with ⌘N.
`;

export function makeTab(
  init: { path?: string | null; content?: string; hash?: string | null },
  existing: Tab[],
): Tab {
  const content = init.content ?? '';
  const path = init.path ?? null;
  return {
    id: newTabId(),
    path,
    title: path ? basename(path) : untitledTitle(existing),
    content,
    saved: content,
    hash: init.hash ?? null,
    dirty: false,
  };
}

export function dirname(path: string): string {
  const i = path.replace(/\\/g, '/').lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}
