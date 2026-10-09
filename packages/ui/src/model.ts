import type { LangSetting } from './i18n';

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

// ── Typography ───────────────────────────────────────────────

/** Font stacks offered in the pickers. Labels are i18n keys. */
export const FONT_STACKS = {
  serif: {
    label: 'font.serif',
    css: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', Georgia, serif",
  },
  sans: {
    label: 'font.sans',
    css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
  },
  wenkai: {
    label: 'font.wenkai',
    css: "'LXGW WenKai', 'LXGW WenKai Screen', 'Kaiti SC', STKaiti, KaiTi, serif",
  },
  mono: {
    label: 'font.mono',
    css: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', monospace",
  },
} as const;
export type FontStackId = keyof typeof FONT_STACKS;

/** A font choice: a known stack, or a family name the user typed. */
export type FontChoice = { stack: FontStackId } | { family: string };

export type FontPreset = 'serif' | 'sans' | 'custom';

export interface Typography {
  /** Use the active theme's fonts; when true, preset/body/code are ignored. */
  followTheme: boolean;
  preset: FontPreset;
  /** Only used when preset === 'custom'. */
  body: FontChoice;
  code: FontChoice;
}

export const PRESET_FONTS: Record<Exclude<FontPreset, 'custom'>, { body: FontChoice; code: FontChoice }> = {
  serif: { body: { stack: 'serif' }, code: { stack: 'mono' } },
  sans: { body: { stack: 'sans' }, code: { stack: 'mono' } },
};

/** CSS font-family for a choice; a typed family falls back to the matching stack. */
export function fontCss(choice: FontChoice, fallback: FontStackId): string {
  if ('stack' in choice) return FONT_STACKS[choice.stack]?.css ?? FONT_STACKS[fallback].css;
  const name = choice.family.trim().replace(/["\\;{}]/g, '');
  return name ? `"${name}", ${FONT_STACKS[fallback].css}` : FONT_STACKS[fallback].css;
}

/** Resolved body/code families, or null when the theme decides. */
export function resolveFonts(t: Typography): { body: string; code: string } | null {
  if (t.followTheme) return null;
  const pick = t.preset === 'custom' ? { body: t.body, code: t.code } : PRESET_FONTS[t.preset];
  return { body: fontCss(pick.body, 'serif'), code: fontCss(pick.code, 'mono') };
}

// ── Settings ─────────────────────────────────────────────────

export interface Settings {
  language: LangSetting;
  /** 'system' | 'light' | 'dark', or a plugin theme id. */
  theme: string;
  typography: Typography;
  fontSize: number;
  lineHeight: number;
  proseWidth: number;
  /** Horizontal padding around the text column, in px. */
  margin: number;
  lineNumbers: boolean;
  typewriter: boolean;
  autoSave: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'system',
  theme: 'system',
  typography: {
    followTheme: true,
    preset: 'serif',
    body: { stack: 'serif' },
    code: { stack: 'mono' },
  },
  fontSize: 16,
  lineHeight: 1.75,
  proseWidth: 760,
  margin: 32,
  lineNumbers: false,
  typewriter: false,
  autoSave: true,
};

export const SETTINGS_KEY = 'aster.settings.v1';

const clamp = (n: unknown, lo: number, hi: number, d: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;

function validFont(c: unknown, d: FontChoice): FontChoice {
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    if (typeof o.stack === 'string' && o.stack in FONT_STACKS) return { stack: o.stack as FontStackId };
    if (typeof o.family === 'string') return { family: o.family.slice(0, 120) };
  }
  return d;
}

/** Merge stored JSON over defaults, dropping anything malformed. */
export function normalizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const ty = (r.typography && typeof r.typography === 'object' ? r.typography : {}) as Record<string, unknown>;
  return {
    language: r.language === 'zh' || r.language === 'en' ? r.language : 'system',
    theme: typeof r.theme === 'string' && r.theme ? r.theme : d.theme,
    typography: {
      followTheme: typeof ty.followTheme === 'boolean' ? ty.followTheme : d.typography.followTheme,
      preset: ty.preset === 'sans' || ty.preset === 'custom' || ty.preset === 'serif' ? ty.preset : d.typography.preset,
      body: validFont(ty.body, d.typography.body),
      code: validFont(ty.code, d.typography.code),
    },
    fontSize: Math.round(clamp(r.fontSize, 12, 28, d.fontSize)),
    lineHeight: Math.round(clamp(r.lineHeight, 1.2, 2.2, d.lineHeight) * 100) / 100,
    proseWidth: clamp(r.proseWidth, 480, 100000, d.proseWidth),
    margin: Math.round(clamp(r.margin, 0, 160, d.margin)),
    lineNumbers: typeof r.lineNumbers === 'boolean' ? r.lineNumbers : d.lineNumbers,
    typewriter: typeof r.typewriter === 'boolean' ? r.typewriter : d.typewriter,
    autoSave: typeof r.autoSave === 'boolean' ? r.autoSave : d.autoSave,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeSettings({});
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export interface PluginTheme { id: string; name: string; cssFile: string; i18n?: Record<string, string> }

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

  // Typography: inline vars override the theme's --theme-font-* defaults.
  const fonts = resolveFonts(s.typography);
  if (fonts) {
    root.style.setProperty('--font-prose', fonts.body);
    root.style.setProperty('--font-mono', fonts.code);
  } else {
    root.style.removeProperty('--font-prose');
    root.style.removeProperty('--font-mono');
  }
  root.style.setProperty('--editor-font-size', `${s.fontSize}px`);
  root.style.setProperty('--editor-line-height', String(s.lineHeight));
  root.style.setProperty('--prose-width', `${s.proseWidth}px`);
  root.style.setProperty('--editor-margin', `${s.margin}px`);
}

// ── Helpers ──────────────────────────────────────────────────

export function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

export function dirname(path: string): string {
  const i = path.replace(/\\/g, '/').lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/**
 * Words for Latin text, characters for CJK, so counts are meaningful in both
 * languages: "Hello 世界" counts as 1 + 2 = 3.
 */
export function wordCount(s: string): number {
  const cjk = s.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  const rest = s.replace(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g, ' ').trim();
  return cjk + (rest ? rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0);
}

/**
 * file path → URL the webview can load, encoding each segment separately so
 * relative URLs inside the loaded file (`./vendor/x.js`, `theme.css`) resolve
 * next to it. Tauri's convertFileSrc encodes the whole path as one segment,
 * which makes every relative URL resolve to the protocol root.
 */
export function fileUrl(path: string, base: string): string {
  const p = path.replace(/\\/g, '/');
  const encoded = p.split('/').map(encodeURIComponent).join('/');
  // Keep the leading '/' of POSIX paths as %2F: the asset handler strips one
  // leading slash and percent-decodes the rest, so this round-trips.
  return base + (p.startsWith('/') ? '%2F' + encoded.slice(1) : encoded);
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';
export const ALT = isMac ? '⌥' : 'Alt+';
export const SHIFT = isMac ? '⇧' : 'Shift+';

let seq = 1;
export function newTabId(): string {
  return `t${Date.now().toString(36)}${(seq++).toString(36)}`;
}

/** Next free "Untitled", "Untitled 2", … using the localized base name. */
export function untitledTitle(existing: Tab[], base = 'Untitled'): string {
  const used = new Set(existing.filter((t) => !t.path).map((t) => t.title));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
  return `${base} ${Date.now()}`;
}

export function makeTab(
  init: { path?: string | null; content?: string; hash?: string | null },
  existing: Tab[],
  untitledBase?: string,
): Tab {
  const content = init.content ?? '';
  const path = init.path ?? null;
  return {
    id: newTabId(),
    path,
    title: path ? basename(path) : untitledTitle(existing, untitledBase),
    content,
    saved: content,
    hash: init.hash ?? null,
    dirty: false,
  };
}
