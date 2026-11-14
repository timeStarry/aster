import { For, Show, createSignal, type JSX } from 'solid-js';
import type { Settings, PluginTheme, FontStackId, FontPreset, Typography } from './model';
import { MOD, ALT, SHIFT, resolveFonts, isWindows } from './model';
import { t, pick, type Key } from './i18n';
import { FontCombobox, type InstalledFont } from './FontCombobox';
import { BrandMark } from './BrandMark';
import { formatBytes, type UpdaterController } from './updater-client';

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
  onOpenRepo: () => void;
  onClose?: () => void;
  updater?: UpdaterController;
  initialSection?: Section;
}

export type Section = 'general' | 'appearance' | 'editor' | 'plugins' | 'shortcuts' | 'about';

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
      ['sc.toggleSidebar', `${MOD}\\`],
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

const TEXT_PRESETS: FontStackId[] = ['sans', 'serif', 'wenkai'];
const MONO_PRESETS: FontStackId[] = ['mono'];

// Static previews matching Aster's 4 built-in themes.
const SWATCHES: Record<string, { bg: string; fg: string; accent: string }> = {
  paper: { bg: '#fcfbf8', fg: '#191c26', accent: '#4250dc' },
  light: { bg: '#ffffff', fg: '#191c26', accent: '#4250dc' },
  dark: { bg: '#191c26', fg: '#eae8e1', accent: '#7b88ff' },
  midnight: { bg: '#0b0c10', fg: '#e6e7ec', accent: '#7b88ff' },
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
      {p.id === 'system' ? <>{half('paper')}{half('dark')}</> : half(p.id)}
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
  const [section, setSection] = createSignal<Section>(props.initialSection ?? 'general');
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => props.onChange({ ...props.settings, [k]: v });
  const setType = (patch: Partial<Typography>) => set('typography', { ...props.settings.typography, ...patch });
  const ty = () => props.settings.typography;

  const themes = () => [
    { id: 'system', name: t('theme.system') },
    { id: 'paper', name: t('theme.paper') },
    { id: 'light', name: t('theme.light') },
    { id: 'dark', name: t('theme.dark') },
    { id: 'midnight', name: t('theme.midnight') },
    ...props.themes
      .filter((th) => th.id !== 'aster.theme-dark')
      .map((th) => ({ id: th.id, name: pick(th.i18n, th.name) })),
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
      <Show when={props.onClose}>
        <button
          type="button"
          class="aster-set-close"
          aria-label={t('set.close')}
          title={`${t('set.close')} (Esc)`}
          onClick={() => props.onClose?.()}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </Show>
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
            >
              <span>{t(s.label)}</span>
              <Show when={s.id === 'about' && props.updater?.hasUpdate()}>
                <span class="aster-nav-dot" aria-hidden="true" />
              </Show>
            </button>
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
              <Row id="set-assets-dir" label={t('set.imageAssetsDir')} hint={t('set.imageAssetsDirHint')}>
                <input
                  id="set-assets-dir"
                  class="aster-text"
                  type="text"
                  aria-labelledby="set-assets-dir-label"
                  value={props.settings.imageAssetsDir}
                  onChange={(e) => {
                    const next = e.currentTarget.value.trim();
                    if (next && !next.includes('..')) set('imageAssetsDir', next);
                  }}
                />
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
              <Show when={isWindows}>
                <Row id="set-menu-bar" label={t('set.showMenuBar')} hint={t('set.showMenuBarHint')}>
                  <Toggle id="set-menu-bar" labelledBy="set-menu-bar-label" checked={props.settings.showMenuBar} onChange={(v) => set('showMenuBar', v)} />
                </Row>
              </Show>
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
                    { value: 'sans', label: t('preset.sans') },
                    { value: 'serif', label: t('preset.serif') },
                    { value: 'wenkai', label: t('preset.wenkai') },
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
              <Row id="set-cjk" label={t('set.cjkSpacing')} hint={t('set.cjkSpacingHint')}>
                <Toggle id="set-cjk" labelledBy="set-cjk-label" checked={props.settings.cjkSpacing} onChange={(v) => set('cjkSpacing', v)} />
              </Row>
              <Row id="set-focus" label={t('set.focusMode')} hint={t('set.focusModeHint')}>
                <Toggle id="set-focus" labelledBy="set-focus-label" checked={props.settings.focusMode} onChange={(v) => set('focusMode', v)} />
              </Row>
              <Row id="set-tw" label={t('set.typewriter')} hint={t('set.typewriterHint')}>
                <Toggle id="set-tw" labelledBy="set-tw-label" checked={props.settings.typewriter} onChange={(v) => set('typewriter', v)} />
              </Row>
              <Row id="set-rail" label={t('set.outlineRail')} hint={t('set.outlineRailHint')}>
                <Toggle id="set-rail" labelledBy="set-rail-label" checked={props.settings.outlineRail} onChange={(v) => set('outlineRail', v)} />
              </Row>
              <Row id="set-slash" label={t('set.slashCommands')} hint={t('set.slashCommandsHint')}>
                <Toggle id="set-slash" labelledBy="set-slash-label" checked={props.settings.slashCommands} onChange={(v) => set('slashCommands', v)} />
              </Row>
              <Row id="set-ln" label={t('set.lineNumbers')} hint={t('set.lineNumbersHint')}>
                <Toggle id="set-ln" labelledBy="set-ln-label" checked={props.settings.lineNumbers} onChange={(v) => set('lineNumbers', v)} />
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
              <BrandMark size={68} class="aster-about-mark" title="Aster" />
              <div class="aster-about-name">Aster</div>
              <div class="aster-about-tag">{t('set.tagline')}</div>
              <div class="aster-set-ver aster-about-ver">{t('about.edition', { v: props.version || '—' })}</div>

              <div class="aster-set-group aster-about-prefs">
                <Show when={props.updater}>
                  {(upd) => {
                    const stageLabel = () => {
                      const st = upd().progress()?.stage;
                      if (st === 'verifying') return t('about.verifying');
                      if (st === 'installing') return t('about.installing');
                      return t('about.downloading', { pct: upd().progress()?.percent ?? 0 });
                    };
                    const sizeLabel = () => formatBytes(upd().info()?.assetSize);
                    const statusText = () => {
                      const res = upd().installResult();
                      if (res) return res.action === 'relaunch' ? t('about.readyRestart') : t('about.installerOpened');
                      if (upd().installing()) return stageLabel();
                      if (upd().checking()) return t('about.checking');
                      if (upd().error()) return upd().error()!;
                      if (upd().info()?.hasUpdate) return t('about.updateAvailable', { v: upd().info()!.latestVersion });
                      if (upd().info()) return t('about.upToDate');
                      return t('about.softwareUpdateHint');
                    };
                    const isAccent = () => !upd().installResult() && !upd().installing() && !upd().error() && Boolean(upd().info()?.hasUpdate);
                    const isErr = () => !upd().installing() && Boolean(upd().error());

                    return (
                      <div class="aster-set-row aster-update-row">
                        <div class="aster-update-row-head">
                          <div class="aster-set-text">
                            <div class="aster-set-label">{t('about.softwareUpdate')}</div>
                            <div
                              class="aster-set-hint"
                              classList={{ 'is-accent': isAccent(), 'is-error': isErr() }}
                            >
                              {statusText()}
                            </div>
                          </div>
                          <div class="aster-set-control">
                            <Show
                              when={!upd().installResult()}
                              fallback={
                                <Show when={upd().installResult()?.action === 'relaunch'}>
                                  <button type="button" class="aster-btn primary" onClick={() => upd().relaunchNow()}>
                                    {t('about.restartNow')}
                                  </button>
                                </Show>
                              }
                            >
                              <Show when={!upd().installing()}>
                                <Show
                                  when={upd().info()?.hasUpdate}
                                  fallback={
                                    <button
                                      type="button"
                                      class="aster-btn"
                                      disabled={upd().checking()}
                                      onClick={() => upd().checkForUpdates(false)}
                                    >
                                      {t('about.checkUpdate')}
                                    </button>
                                  }
                                >
                                  <button type="button" class="aster-btn primary" onClick={() => upd().downloadAndInstall()}>
                                    {sizeLabel()
                                      ? t('about.downloadAndInstall', { size: sizeLabel() })
                                      : t('about.downloadAndInstallNoSize')}
                                  </button>
                                </Show>
                              </Show>
                            </Show>
                          </div>
                        </div>

                        <Show when={upd().installing()}>
                          <div class="aster-update-bar" role="progressbar" aria-valuenow={upd().progress()?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
                            <div class="aster-update-bar-fill" style={{ width: `${upd().progress()?.percent ?? 15}%` }} />
                          </div>
                        </Show>

                        <Show when={!upd().installing() && !upd().installResult() && upd().info()?.hasUpdate}>
                          <Show when={upd().info()?.releaseNotes?.trim()}>
                            <pre class="aster-update-notes aster-selectable">{upd().info()!.releaseNotes.trim()}</pre>
                          </Show>
                          <div class="aster-update-sublink">
                            <button type="button" class="aster-link-inline" onClick={() => upd().openReleaseUrl()}>
                              {t('about.openReleasePage')} ↗
                            </button>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </Show>

                <Row id="set-auto-update" label={t('about.autoCheck')} hint={t('about.autoCheckHint')}>
                  <Toggle
                    id="set-auto-update"
                    checked={props.settings.updateCheckEnabled}
                    labelledBy="set-auto-update-label"
                    onChange={(v) => set('updateCheckEnabled', v)}
                  />
                </Row>
              </div>

              <div class="aster-about-footer">
                <button class="aster-about-link" onClick={() => props.onOpenRepo()}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  <span>github.com/timeStarry/aster</span>
                </button>
                <span class="aster-about-lic">{t('about.license')}</span>
              </div>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
}
