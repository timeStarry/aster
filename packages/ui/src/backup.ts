import { normalizeSettings, type Settings } from './model';
import type { Key } from './i18n';

/**
 * Settings backup file.
 *
 * Only settings travel in the file. Plugins are referenced by id and version
 * so the user can see what a setup relied on, but importing never installs,
 * enables or runs anything: a settings file is data, and plugins are code
 * that must come from a trusted source through the normal install path.
 */

export const BACKUP_KIND = 'aster.settings';
export const BACKUP_VERSION = 1;

export interface PluginRef { id: string; version: string }

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: number;
  appVersion: string;
  exportedAt: string;
  settings: Settings;
  plugins: PluginRef[];
}

export type ImportErrorKey = 'import.badJson' | 'import.notSettings' | 'import.tooNew';

export class BackupError extends Error {
  constructor(readonly key: ImportErrorKey) { super(key); }
}

/** i18n label for each setting, used to describe what an import changes. */
export const SETTING_LABELS: Record<keyof Settings, Key> = {
  language: 'set.language',
  theme: 'set.theme',
  showMenuBar: 'set.showMenuBar',
  typography: 'set.typography',
  fontSize: 'set.fontSize',
  lineHeight: 'set.lineHeight',
  proseWidth: 'set.lineWidth',
  lineNumbers: 'set.lineNumbers',
  typewriter: 'set.typewriter',
  outlineRail: 'set.outlineRail',
  autoSave: 'set.autoSave',
};

const BUILTIN_THEMES = new Set(['system', 'light', 'dark']);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function buildBackup(settings: Settings, plugins: PluginRef[], appVersion: string, now = new Date()): string {
  const file: BackupFile = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    settings,
    plugins: plugins.map((p) => ({ id: p.id, version: p.version })),
  };
  return JSON.stringify(file, null, 2) + '\n';
}

export interface ImportPlan {
  /** Settings to apply: the current ones with every valid imported value on top. */
  settings: Settings;
  /** Settings whose value would change. */
  changed: (keyof Settings)[];
  /** Keys in the file that were unknown or invalid; the current value is kept. */
  dropped: string[];
  /** Plugins the file mentions that aren't installed here. */
  missingPlugins: string[];
  /** Imported theme id that no installed plugin provides, if any. */
  missingTheme: string | null;
}

/**
 * Validate a backup and work out what importing it would do, without applying
 * anything. Invalid values are skipped individually rather than failing the
 * whole import, and each skip is reported.
 */
export function planImport(
  text: string,
  current: Settings,
  installed: { plugins: string[]; themes: string[] },
): ImportPlan {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new BackupError('import.badJson'); }
  if (!raw || typeof raw !== 'object') throw new BackupError('import.notSettings');
  const file = raw as Partial<BackupFile> & Record<string, unknown>;
  if (file.kind !== BACKUP_KIND || !file.settings || typeof file.settings !== 'object') {
    throw new BackupError('import.notSettings');
  }
  if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) throw new BackupError('import.tooNew');

  const incoming = file.settings as unknown as Record<string, unknown>;
  const known = Object.keys(SETTING_LABELS) as (keyof Settings)[];
  let next: Settings = { ...current };
  const dropped: string[] = [];

  for (const [k, v] of Object.entries(incoming)) {
    if (!known.includes(k as keyof Settings)) { dropped.push(k); continue; }
    const key = k as keyof Settings;
    // Accept a value only if validation keeps it exactly as written.
    const candidate = normalizeSettings({ ...next, [key]: v } as unknown)[key];
    if (same(candidate, v)) next = { ...next, [key]: candidate } as Settings;
    else dropped.push(k);
  }

  const changed = known.filter((k) => !same(next[k], current[k]));
  const have = new Set(installed.plugins);
  const missingPlugins = (Array.isArray(file.plugins) ? file.plugins : [])
    .map((p) => (p && typeof p === 'object' && typeof (p as PluginRef).id === 'string' ? (p as PluginRef).id : ''))
    .filter((id) => id && !have.has(id));
  const missingTheme = !BUILTIN_THEMES.has(next.theme) && !installed.themes.includes(next.theme) ? next.theme : null;

  return { settings: next, changed, dropped, missingPlugins, missingTheme };
}
