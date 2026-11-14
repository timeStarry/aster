import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { DEFAULT_SETTINGS, basename, type Settings, type PluginTheme } from './model';
import { buildBackup, planImport, BackupError, SETTING_LABELS } from './backup';
import { t } from './i18n';
import type { ConfirmButton } from './ConfirmModal';
import type { PluginRow } from './SettingsPane';

interface SettingsIoDeps {
  getSettings: () => Settings;
  getPlugins: () => PluginRow[];
  getPluginThemes: () => PluginTheme[];
  getVersion: () => string;
  onApply: (s: Settings) => void;
  flash: (text: string, error?: boolean) => void;
  ask: (title: string, message: string, buttons: ConfirmButton[], cancelId: string) => Promise<string>;
}

const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e);
const settingsFilters = () => [{ name: t('dialog.settingsJson'), extensions: ['json'] }];

export async function exportSettingsFile(deps: SettingsIoDeps): Promise<boolean> {
  const stamp = new Date().toISOString().slice(0, 10);
  const path = await saveDialog({ defaultPath: `aster-settings-${stamp}.json`, filters: settingsFilters() });
  if (!path) return false;
  const text = buildBackup(
    deps.getSettings(),
    deps.getPlugins().map((p) => ({ id: p.id, version: p.version })),
    deps.getVersion(),
  );
  try {
    await invoke('settings_file_write', { path, contents: text });
    deps.flash(t('notice.exported', { name: basename(path) }));
    return true;
  } catch (e) {
    deps.flash(t('notice.saveFailed', { err: errText(e) }), true);
    return false;
  }
}

export async function importSettingsFile(deps: SettingsIoDeps): Promise<void> {
  const picked = await openDialog({ multiple: false, filters: settingsFilters() });
  if (!picked || Array.isArray(picked)) return;
  let plan;
  try {
    const text = await invoke<string>('settings_file_read', { path: picked });
    plan = planImport(text, deps.getSettings(), {
      plugins: deps.getPlugins().map((p) => p.id),
      themes: deps.getPluginThemes().map((th) => th.id),
    });
  } catch (e) {
    deps.flash(t('notice.importFailed', { err: e instanceof BackupError ? t(e.key) : errText(e) }), true);
    return;
  }
  const lines: string[] = [];
  if (plan.changed.length) {
    lines.push(t('confirm.importChanges', { n: plan.changed.length, list: plan.changed.map((k) => t(SETTING_LABELS[k])).join('、') }));
  } else {
    lines.push(t('confirm.importNoChange'));
  }
  if (plan.dropped.length) lines.push(t('confirm.importDropped', { list: plan.dropped.join(', ') }));
  if (plan.missingTheme) lines.push(t('confirm.importTheme', { name: plan.missingTheme }));
  if (plan.missingPlugins.length) lines.push(t('confirm.importPlugins', { list: plan.missingPlugins.join(', ') }));
  if (!plan.changed.length && lines.length === 1) {
    deps.flash(t('confirm.importNoChange'));
    return;
  }
  const choice = await deps.ask(
    t('confirm.importTitle', { name: basename(picked) }),
    lines.join('\n'),
    [
      { id: 'cancel', label: t('confirm.cancel') },
      { id: 'import', label: t('confirm.import'), kind: 'primary' },
    ],
    'cancel',
  );
  if (choice !== 'import') return;
  deps.onApply(plan.settings);
  deps.flash(t('notice.imported'));
}

export async function resetSettingsWithPrompt(deps: SettingsIoDeps): Promise<void> {
  const choice = await deps.ask(
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
  if (choice === 'export' && !(await exportSettingsFile(deps))) return;
  deps.onApply({ ...DEFAULT_SETTINGS, typography: { ...DEFAULT_SETTINGS.typography } });
  deps.flash(t('notice.reset'));
}
