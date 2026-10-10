import { describe, it, expect } from 'vitest';
import { buildBackup, planImport, BackupError } from '../src/backup';
import { DEFAULT_SETTINGS } from '../src/model';

const installed = { plugins: ['aster.math'], themes: [] as string[] };

describe('settings backup', () => {
  it('round-trips: exporting then importing current settings changes nothing', () => {
    const text = buildBackup(DEFAULT_SETTINGS, [{ id: 'aster.math', version: '1.1.0' }], '0.1.0-alpha.6');
    const plan = planImport(text, DEFAULT_SETTINGS, installed);
    expect(plan.changed).toEqual([]);
    expect(plan.dropped).toEqual([]);
    expect(plan.missingPlugins).toEqual([]);
  });

  it('applies valid values, skips invalid and unknown ones', () => {
    const file = JSON.parse(buildBackup(DEFAULT_SETTINGS, [], 'x'));
    file.settings.fontSize = 18;
    file.settings.lineHeight = 'tall';
    file.settings.evil = '<script>';
    const plan = planImport(JSON.stringify(file), DEFAULT_SETTINGS, installed);
    expect(plan.settings.fontSize).toBe(18);
    expect(plan.settings.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
    expect(plan.changed).toEqual(['fontSize']);
    expect(plan.dropped.sort()).toEqual(['evil', 'lineHeight']);
  });

  it('reports plugins and plugin themes that are not installed, and never installs them', () => {
    const file = JSON.parse(buildBackup({ ...DEFAULT_SETTINGS, theme: 'acme.solar' }, [{ id: 'acme.solar', version: '1' }], 'x'));
    const plan = planImport(JSON.stringify(file), DEFAULT_SETTINGS, installed);
    expect(plan.missingPlugins).toEqual(['acme.solar']);
    expect(plan.missingTheme).toBe('acme.solar');
  });

  it('rejects files that are not Aster settings or are from a newer version', () => {
    const err = (text: string) => { try { planImport(text, DEFAULT_SETTINGS, installed); } catch (e) { return (e as BackupError).key; } return null; };
    expect(err('not json')).toBe('import.badJson');
    expect(err('{"hello":1}')).toBe('import.notSettings');
    expect(err(JSON.stringify({ kind: 'aster.settings', version: 99, settings: {} }))).toBe('import.tooNew');
  });
});
