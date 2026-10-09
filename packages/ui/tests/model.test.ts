import { describe, it, expect } from 'vitest';
import { fileUrl, normalizeSettings, resolveFonts, wordCount, DEFAULT_SETTINGS } from '../src/model';
import { t, applyLanguage } from '../src/i18n';

// Mirror of Tauri's asset handler: drop the leading '/', percent-decode the rest.
const served = (u: string) => decodeURIComponent(new URL(u).pathname.slice(1));

describe('fileUrl', () => {
  const entry = '/Applications/Aster.app/Contents/Resources/bundled-plugins/aster.math/frontend/index.js';

  it('round-trips to the original path', () => {
    expect(served(fileUrl(entry, 'asset://localhost/'))).toBe(entry);
  });

  it('lets relative URLs resolve next to the file', () => {
    const base = fileUrl(entry, 'asset://localhost/');
    expect(served(new URL('./vendor/katex.mjs', base).href))
      .toBe('/Applications/Aster.app/Contents/Resources/bundled-plugins/aster.math/frontend/vendor/katex.mjs');
    const css = new URL('./vendor/katex.min.css', base).href;
    expect(served(new URL('fonts/KaTeX_Main-Regular.woff2', css).href)).toMatch(/vendor\/fonts\/KaTeX_Main-Regular\.woff2$/);
  });

  it('handles spaces and Windows paths', () => {
    expect(served(new URL('a.js', fileUrl('/Users/a b/x/index.js', 'asset://localhost/')).href)).toBe('/Users/a b/x/a.js');
    const win = fileUrl(String.raw`C:\Program Files\Aster\p\index.js`, 'http://asset.localhost/');
    expect(served(new URL('./vendor/m.js', win).href)).toBe('C:/Program Files/Aster/p/vendor/m.js');
  });
});

describe('settings', () => {
  it('fills defaults and drops malformed values', () => {
    const s = normalizeSettings({ fontSize: 99, lineHeight: 'x', language: 'fr', typography: { preset: 'nope', body: { stack: 'bogus' } } });
    expect(s.fontSize).toBe(28);
    expect(s.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
    expect(s.language).toBe('system');
    expect(s.typography.preset).toBe('serif');
    expect(s.typography.body).toEqual({ stack: 'serif' });
  });

  it('migrates v1 settings without typography', () => {
    const s = normalizeSettings({ theme: 'dark', fontSize: 18, proseWidth: 920 });
    expect(s.theme).toBe('dark');
    expect(s.fontSize).toBe(18);
    expect(s.typography.followTheme).toBe(true);
  });

  it('resolves fonts from presets and custom picks', () => {
    const base = DEFAULT_SETTINGS.typography;
    expect(resolveFonts(base)).toBeNull();
    expect(resolveFonts({ ...base, followTheme: false, preset: 'sans' })!.body).toContain('sans-serif');
    const custom = resolveFonts({ ...base, followTheme: false, preset: 'custom', body: { family: 'My "Font"; x' }, code: { stack: 'mono' } })!;
    expect(custom.body.startsWith('"My Font x"')).toBe(true); // quotes/semicolons stripped
    expect(custom.code).toContain('monospace');
  });
});

describe('wordCount', () => {
  it('counts CJK characters and Latin words', () => {
    expect(wordCount('Hello 世界')).toBe(3);
    expect(wordCount('# 标题\n\n- one two')).toBe(4);
    expect(wordCount('   ')).toBe(0);
  });
});

describe('i18n', () => {
  it('translates with placeholders and falls back to English', () => {
    applyLanguage('zh');
    expect(t('notice.saved', { name: 'a.md' })).toBe('已保存 a.md');
    applyLanguage('en');
    expect(t('notice.saved', { name: 'a.md' })).toBe('Saved a.md');
  });
});
