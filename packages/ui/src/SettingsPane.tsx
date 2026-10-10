import { For, Show, createSignal, type JSX } from 'solid-js';
import type { Settings, PluginTheme, FontChoice, FontStackId, FontPreset, Typography } from './model';
import { MOD, ALT, SHIFT, FONT_STACKS, resolveFonts } from './model';
import { t, pick, type Key } from './i18n';
import { FontCombobox, type InstalledFont } from './FontCombobox';
import { BrandMark } from './BrandMark';

export interface PluginRow {
  id: string;
  name: string;
  version: string;
  description: string;
  source: string;
  i18n?: Record<string, { name?: string; description?: string }>;
}

interface Props {
  settings: Settings;
  plugins: PluginRow[];
  themes: PluginTheme[];
  /** Installed font families; null while loading. */
  fonts: InstalledFont[] | null;
  version: string;
  onChange: (s: Settings) => void;
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
}

type Section = 'general' | 'appearance' | 'editor' | 'plugins' | 'shortcuts' | 'about';

const SECTIONS: { id: Section; label: Key }[] = [
  { id: 'general', label: 'set.general' },
  { id: 'appearance', label: 'set.appearance' },
  { id: 'editor', label: 'set.editor' },
  { id: 'plugins', label: 'set.plugins' },
  { id: 'shortcuts', label: 'set.shortcuts' },
  { id: 'about', label: 'set.about' },
];

const SHORTCUT_GROUPS: { title: Key; rows: [Key, string][] }[] = [
  {
    title: 'sc.formatting',
    rows: [
      ['sc.bold', `${MOD}B`],
      ['sc.italic', `${MOD}I`],
      ['sc.code', `${MOD}E`],
      ['sc.strike', `${MOD}${SHIFT}X`],
      ['sc.link', `${MOD}K`],
      ['sc.heading', `${MOD}1 – ${MOD}6`],
      ['sc.paragraph', `${MOD}0`],
      ['sc.bullet', `${MOD}${SHIFT}8`],
      ['sc.ordered', `${MOD}${SHIFT}7`],
      ['sc.task', `${MOD}${SHIFT}9`],
      ['sc.quote', `${MOD}${SHIFT}.`],
      ['sc.codeBlock', `${MOD}${ALT}C`],
      ['sc.table', `${MOD}${ALT}T`],
    ],
  },
  {
    title: 'sc.editing',
    rows: [
      ['sc.find', `${MOD}F`],
      ['sc.toggleMode', `${MOD}/`],
      ['sc.toggleLock', `${MOD}${ALT}L`],
      ['sc.indent', `Tab / ${SHIFT}Tab`],
    ],
  },
  {
    title: 'sc.files',
    rows: [
      ['sc.newTab', `${MOD}N`],
      ['sc.open', `${MOD}O`],
      ['sc.save', `${MOD}S`],
      ['sc.saveAs', `${MOD}${SHIFT}S`],
      ['sc.closeTab', `${MOD}W`],
      ['sc.cycleTab', `Ctrl+Tab / Ctrl+${SHIFT}Tab`],
      ['sc.settings', `${MOD},`],
    ],
  },
];

const WIDTHS: { value: number; label: Key }[] = [
  { value: 640, label: 'width.narrow' },
  { value: 760, label: 'width.comfortable' },
  { value: 920, label: 'width.wide' },
  { value: 100000, label: 'width.full' },
];

const TEXT_PRESETS: FontStackId[] = ['serif', 'sans', 'wenkai'];
const MONO_PRESETS: FontStackId[] = ['mono'];

// Static previews; the real colors live in theme.css / plugin CSS.
const SWATCHES: Record<string, { bg: string; fg: string; accent: string }> = {
  light: { bg: '#fbfbfa', fg: '#1c1917', accent: '#4f46e5' },
  dark: { bg: '#22272e', fg: '#adbac7', accent: '#539bf5' },
};

function Swatch(p: { id: string }) {
  const s = (id: string) => SWATCHES[id] ?? { bg: '#0f172a', fg: '#e2e8f0', accent: '#38bdf8' };
  const half = (id: string) => (
    <span class="aster-swatch-half" style={{ background: s(id).bg }}>
      <span class="aster-swatch-line" style={{ background: s(id).fg, width: '70%' }} />
      <span class="aster-swatch-line" style={{ background: s(id).fg, width: '50%', opacity: 0.6 }} />
      <span class="aster-swatch-line" style={{ background: s(id).accent, width: '35%' }} />
    </span>
  );
  return (
    <span class="aster-swatch" aria-hidden="true">
      {p.id === 'system' ? <>{half('light')}{half('dark')}</> : half(p.id)}
    </span>
  );
}

function Toggle(p: { id: string; checked: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return (
    <button
      id={p.id}
      type="button"
      role="switch"
      class="aster-switch"
      aria-checked={p.checked}
      aria-labelledby={p.labelledBy}
      onClick={() => p.onChange(!p.checked)}
    >
      <span class="aster-switch-knob" />
    </button>
  );
}

function Row(p: { label: string; hint?: string; id: string; disabled?: boolean; children: JSX.Element }) {
  return (
    <div class="aster-set-row" classList={{ 'is-disabled': p.disabled }}>
      <div class="aster-set-text">
        <div class="aster-set-label" id={`${p.id}-label`}>{p.label}</div>
        <Show when={p.hint}><div class="aster-set-hint">{p.hint}</div></Show>
      </div>
      <div class="aster-set-control">{p.children}</div>
    </div>
  );
}

function Segmented<T extends string | number>(p: {
  labelledBy: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div class="aster-seg aster-seg-lg" role="radiogroup" aria-labelledby={p.labelledBy} aria-disabled={p.disabled}>
      <For each={p.options}>
        {(o) => (
          <button
            type="button"
            role="radio"
            aria-checked={p.value === o.value}
            classList={{ 'is-on': p.value === o.value }}
            disabled={p.disabled}
            onClick={() => p.onChange(o.value)}
          >{o.label}</button>
        )}
      </For>
    </div>
  );
}

function Range(p: {
  id: string; min: number; max: number; step: number; value: number;
  format: (v: number) => string; disabled?: boolean; onInput: (v: number) => void;
}) {
  return (
    <div class="aster-range">
      <input
        id={p.id}
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        disabled={p.disabled}
        aria-labelledby={`${p.id}-label`}
        aria-valuetext={p.format(p.value)}
        onInput={(e) => p.onInput(Number(e.currentTarget.value))}
      />
      <output for={p.id}>{p.format(p.value)}</output>
    </div>
  );
}

export function SettingsPane(props: Props) {
  const [section, setSection] = createSignal<Section>('general');
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => props.onChange({ ...props.settings, [k]: v });
  const setType = (patch: Partial<Typography>) => set('typography', { ...props.settings.typography, ...patch });
  const ty = () => props.settings.typography;

  const themes = () => [
    { id: 'system', name: t('theme.system') },
    { id: 'light', name: t('theme.light') },
    { id: 'dark', name: t('theme.dark') },
    ...props.themes.map((th) => ({ id: th.id, name: pick(th.i18n, th.name) })),
  ];

  // Preview reflects the effective fonts, including "use theme fonts".
  const previewFonts = () => resolveFonts(ty()) ?? { body: 'var(--font-prose)', code: 'var(--font-mono)' };

  const onNavKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = SECTIONS.findIndex((s) => s.id === section());
    const next = SECTIONS[(i + (e.key === 'ArrowDown' ? 1 : -1) + SECTIONS.length) % SECTIONS.length];
    setSection(next.id);
    document.getElementById(`aster-set-nav-${next.id}`)?.focus();
  };

  return (
    <div class="aster-settings">
      <nav class="aster-set-nav" aria-label={t('set.title')} role="tablist" aria-orientation="vertical" onKeyDown={onNavKey}>
        <h1 class="aster-set-title">{t('set.title')}</h1>
        <For each={SECTIONS}>
          {(s) => (
            <button
              id={`aster-set-nav-${s.id}`}
              role="tab"
              aria-selected={section() === s.id}
              aria-controls="aster-set-panel"
              tabIndex={section() === s.id ? 0 : -1}
              classList={{ 'is-on': section() === s.id }}
              onClick={() => setSection(s.id)}
            >{t(s.label)}</button>
          )}
        </For>
      </nav>

      <div class="aster-set-scroll">
        <section class="aster-set-panel" id="aster-set-panel" role="tabpanel" aria-labelledby={`aster-set-nav-${section()}`}>
          <Show when={section() === 'general'}>
            <h2>{t('set.general')}</h2>
            <div class="aster-set-group">
              <Row id="set-lang" label={t('set.language')} hint={t('set.languageHint')}>
                <select
                  id="set-lang"
                  aria-labelledby="set-lang-label"
                  value={props.settings.language}
                  onChange={(e) => set('language', e.currentTarget.value as Settings['language'])}
                >
                  <option value="system">{t('set.languageSystem')}</option>
                  <option value="zh" lang="zh-CN">简体中文</option>
                  <option value="en" lang="en">English</option>
                </select>
              </Row>
            </div>
            <h3>{t('set.files')}</h3>
            <div class="aster-set-group">
              <Row id="set-as" label={t('set.autoSave')} hint={t('set.autoSaveHint')}>
                <Toggle id="set-as" labelledBy="set-as-label" checked={props.settings.autoSave} onChange={(v) => set('autoSave', v)} />
              </Row>
            </div>
            <h3>{t('set.backup')}</h3>
            <div class="aster-set-group">
              <Row id="set-export" label={t('set.export')} hint={t('set.exportHint')}>
                <button class="aster-btn" onClick={() => props.onExport()}>{t('set.exportBtn')}</button>
              </Row>
              <Row id="set-import" label={t('set.import')} hint={t('set.importHint')}>
                <button class="aster-btn" onClick={() => props.onImport()}>{t('set.importBtn')}</button>
              </Row>
              <Row id="set-reset" label={t('set.reset')} hint={t('set.resetHint')}>
                <button class="aster-btn danger" onClick={() => props.onReset()}>{t('set.resetBtn')}</button>
              </Row>
            </div>
          </Show>

          <Show when={section() === 'appearance'}>
            <h2>{t('set.appearance')}</h2>
            <div class="aster-set-group">
              <div class="aster-set-row is-stacked">
                <div class="aster-set-text">
                  <div class="aster-set-label" id="set-theme-label">{t('set.theme')}</div>
                </div>
                <div class="aster-theme-grid" role="radiogroup" aria-labelledby="set-theme-label">
                  <For each={themes()}>
                    {(th) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={props.settings.theme === th.id}
                        class="aster-theme-card"
                        classList={{ 'is-on': props.settings.theme === th.id }}
                        onClick={() => set('theme', th.id)}
                      >
                        <Swatch id={th.id} />
                        <span>{th.name}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </Show>

          <Show when={section() === 'editor'}>
            <h2>{t('set.editor')}</h2>

            <h3>{t('set.typography')}</h3>
            <div class="aster-set-group">
              <Row id="set-ft" label={t('set.followTheme')} hint={t('set.followThemeHint')}>
                <Toggle id="set-ft" labelledBy="set-ft-label" checked={ty().followTheme} onChange={(v) => setType({ followTheme: v })} />
              </Row>
              <Row id="set-preset" label={t('set.fontStyle')} hint={t('set.fontStyleHint')} disabled={ty().followTheme}>
                <Segmented<FontPreset>
                  labelledBy="set-preset-label"
                  value={ty().preset}
                  disabled={ty().followTheme}
                  options={[
                    { value: 'serif', label: t('preset.serif') },
                    { value: 'sans', label: t('preset.sans') },
                    { value: 'custom', label: t('preset.custom') },
                  ]}
                  onChange={(v) => setType({ preset: v })}
                />
              </Row>
              <Show when={!ty().followTheme && ty().preset === 'custom'}>
                <Row id="set-body" label={t('set.textFont')} hint={t('set.textFontHint')}>
                  <FontCombobox
                    id="set-body"
                    labelledBy="set-body-label"
                    value={ty().body}
                    presets={TEXT_PRESETS}
                    fonts={props.fonts}
                    onChange={(c) => setType({ body: c })}
                  />
                </Row>
                <Row id="set-code" label={t('set.monoFont')} hint={t('set.monoFontHint')}>
                  <FontCombobox
                    id="set-code"
                    labelledBy="set-code-label"
                    value={ty().code}
                    presets={MONO_PRESETS}
                    fonts={props.fonts}
                    monoOnly
                    onChange={(c) => setType({ code: c })}
                  />
                </Row>
              </Show>
              <div class="aster-set-row is-stacked">
                <div class="aster-set-label">{t('set.preview')}</div>
                <div
                  class="aster-type-preview"
                  style={{
                    'font-family': previewFonts().body,
                    'font-size': `${props.settings.fontSize}px`,
                    'line-height': String(props.settings.lineHeight),
                  }}
                >
                  <div class="aster-type-preview-h">{t('set.previewHeading')}</div>
                  <p>{t('set.previewBody')}</p>
                  <code style={{ 'font-family': previewFonts().code }}>const answer = 42; // 代码</code>
                </div>
              </div>
            </div>

            <h3>{t('set.layout')}</h3>
            <div class="aster-set-group">
              <Row id="set-size" label={t('set.fontSize')}>
                <Range id="set-size" min={12} max={24} step={1} value={props.settings.fontSize}
                  format={(v) => `${v}px`} onInput={(v) => set('fontSize', v)} />
              </Row>
              <Row id="set-lh" label={t('set.lineHeight')}>
                <Range id="set-lh" min={1.3} max={2.2} step={0.05} value={props.settings.lineHeight}
                  format={(v) => v.toFixed(2)} onInput={(v) => set('lineHeight', Math.round(v * 100) / 100)} />
              </Row>
              <Row id="set-width" label={t('set.lineWidth')} hint={t('set.lineWidthHint')}>
                <Segmented<number>
                  labelledBy="set-width-label"
                  value={props.settings.proseWidth}
                  options={WIDTHS.map((w) => ({ value: w.value, label: t(w.label) }))}
                  onChange={(v) => set('proseWidth', v)}
                />
              </Row>
            </div>

            <h3>{t('set.behavior')}</h3>
            <div class="aster-set-group">
              <Row id="set-ln" label={t('set.lineNumbers')} hint={t('set.lineNumbersHint')}>
                <Toggle id="set-ln" labelledBy="set-ln-label" checked={props.settings.lineNumbers} onChange={(v) => set('lineNumbers', v)} />
              </Row>
              <Row id="set-tw" label={t('set.typewriter')} hint={t('set.typewriterHint')}>
                <Toggle id="set-tw" labelledBy="set-tw-label" checked={props.settings.typewriter} onChange={(v) => set('typewriter', v)} />
              </Row>
              <Row id="set-rail" label={t('set.outlineRail')} hint={t('set.outlineRailHint')}>
                <Toggle id="set-rail" labelledBy="set-rail-label" checked={props.settings.outlineRail} onChange={(v) => set('outlineRail', v)} />
              </Row>
            </div>
          </Show>

          <Show when={section() === 'plugins'}>
            <h2>{t('set.plugins')}</h2>
            <Show when={props.plugins.length > 0} fallback={<p class="aster-set-empty">{t('set.noPlugins')}</p>}>
              <div class="aster-set-group">
                <For each={props.plugins}>
                  {(p) => (
                    <div class="aster-set-row">
                      <div class="aster-set-text">
                        <div class="aster-set-label">
                          {pick(Object.fromEntries(Object.entries(p.i18n ?? {}).map(([k, v]) => [k, v.name])), p.name)}{' '}
                          <span class="aster-set-ver">{p.version}</span>
                        </div>
                        <div class="aster-set-hint">
                          {pick(Object.fromEntries(Object.entries(p.i18n ?? {}).map(([k, v]) => [k, v.description])), p.description)}
                        </div>
                      </div>
                      <span class="aster-badge">{p.source === 'Builtin' ? t('set.builtIn') : t('set.user')}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          <Show when={section() === 'shortcuts'}>
            <h2>{t('set.shortcuts')}</h2>
            <For each={SHORTCUT_GROUPS}>
              {(g) => (
                <>
                  <h3>{t(g.title)}</h3>
                  <div class="aster-set-group">
                    <For each={g.rows}>
                      {([what, keys]) => (
                        <div class="aster-set-row is-compact">
                          <div class="aster-set-label">{t(what)}</div>
                          <kbd>{keys}</kbd>
                        </div>
                      )}
                    </For>
                  </div>
                </>
              )}
            </For>
          </Show>

          <Show when={section() === 'about'}>
            <h2>{t('set.about')}</h2>
            <div class="aster-about">
              <BrandMark size={72} class="aster-about-mark" title="Aster" />
              <div class="aster-about-name">Aster <span class="aster-about-zh" lang="zh-CN">星文</span></div>
              <div class="aster-about-tag">{t('set.tagline')}</div>
              <div class="aster-set-ver aster-about-ver">{t('about.edition', { v: props.version || '—' })}</div>
              <div class="aster-about-lic">{t('about.license')}</div>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
}
