import { For, Show, createSignal, type JSX } from 'solid-js';
import type { Settings, PluginTheme } from './model';
import { MOD, ALT, SHIFT } from './model';

export interface PluginRow {
  id: string;
  name: string;
  version: string;
  description: string;
  source: string;
}

interface Props {
  settings: Settings;
  plugins: PluginRow[];
  themes: PluginTheme[];
  version: string;
  onChange: (s: Settings) => void;
}

type Section = 'appearance' | 'editor' | 'files' | 'plugins' | 'shortcuts' | 'about';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'files', label: 'Files' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'about', label: 'About' },
];

const SHORTCUT_GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Formatting',
    rows: [
      ['Bold', `${MOD}B`],
      ['Italic', `${MOD}I`],
      ['Inline code', `${MOD}E`],
      ['Strikethrough', `${MOD}${SHIFT}X`],
      ['Link', `${MOD}K`],
      ['Heading 1–6', `${MOD}1 – ${MOD}6`],
      ['Paragraph', `${MOD}0`],
      ['Bullet list', `${MOD}${SHIFT}8`],
      ['Numbered list', `${MOD}${SHIFT}7`],
      ['Task list', `${MOD}${SHIFT}9`],
      ['Quote', `${MOD}${SHIFT}.`],
      ['Code block', `${MOD}${ALT}C`],
      ['Table', `${MOD}${ALT}T`],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Find / Replace', `${MOD}F`],
      ['Toggle Live / Source', `${MOD}/`],
      ['Toggle read-only', `${MOD}${ALT}L`],
      ['Indent / Outdent list item', `Tab / ${SHIFT}Tab`],
    ],
  },
  {
    title: 'Files & Tabs',
    rows: [
      ['New tab', `${MOD}N`],
      ['Open', `${MOD}O`],
      ['Save', `${MOD}S`],
      ['Save as', `${MOD}${SHIFT}S`],
      ['Close tab', `${MOD}W`],
      ['Next / Previous tab', `Ctrl+Tab / Ctrl+${SHIFT}Tab`],
      ['Settings', `${MOD},`],
    ],
  },
];

const WIDTHS: { value: number; label: string }[] = [
  { value: 640, label: 'Narrow' },
  { value: 760, label: 'Comfortable' },
  { value: 920, label: 'Wide' },
  { value: 100000, label: 'Full' },
];

// Static previews; the real colors live in theme.css.
const SWATCHES: Record<string, { bg: string; fg: string; accent: string }> = {
  light: { bg: '#fbfbfa', fg: '#1c1917', accent: '#4f46e5' },
  dark: { bg: '#1c1917', fg: '#e7e5e4', accent: '#818cf8' },
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

function Row(p: { label: string; hint?: string; id: string; children: JSX.Element }) {
  return (
    <div class="aster-set-row">
      <div class="aster-set-text">
        <div class="aster-set-label" id={`${p.id}-label`}>{p.label}</div>
        <Show when={p.hint}><div class="aster-set-hint">{p.hint}</div></Show>
      </div>
      <div class="aster-set-control">{p.children}</div>
    </div>
  );
}

export function SettingsPane(props: Props) {
  const [section, setSection] = createSignal<Section>('appearance');
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => props.onChange({ ...props.settings, [k]: v });

  const themes = () => [
    { id: 'system', name: 'System' },
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
    ...props.themes.map((t) => ({ id: t.id, name: t.name })),
  ];

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
      <nav class="aster-set-nav" aria-label="Settings sections" role="tablist" aria-orientation="vertical" onKeyDown={onNavKey}>
        <h1 class="aster-set-title">Settings</h1>
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
            >{s.label}</button>
          )}
        </For>
      </nav>

      <div class="aster-set-scroll">
        <section class="aster-set-panel" id="aster-set-panel" role="tabpanel" aria-labelledby={`aster-set-nav-${section()}`}>
          <Show when={section() === 'appearance'}>
            <h2>Appearance</h2>
            <div class="aster-set-group">
              <div class="aster-set-row is-stacked">
                <div class="aster-set-text">
                  <div class="aster-set-label" id="set-theme-label">Theme</div>
                </div>
                <div class="aster-theme-grid" role="radiogroup" aria-labelledby="set-theme-label">
                  <For each={themes()}>
                    {(t) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={props.settings.theme === t.id}
                        class="aster-theme-card"
                        classList={{ 'is-on': props.settings.theme === t.id }}
                        onClick={() => set('theme', t.id)}
                      >
                        <Swatch id={t.id} />
                        <span>{t.name}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <Row id="set-font" label="Font size" hint="Size of document text">
                <div class="aster-range">
                  <input
                    id="set-font"
                    type="range"
                    min="12"
                    max="24"
                    step="1"
                    value={props.settings.fontSize}
                    aria-labelledby="set-font-label"
                    onInput={(e) => set('fontSize', Number(e.currentTarget.value))}
                  />
                  <output for="set-font">{props.settings.fontSize}px</output>
                </div>
              </Row>
              <Row id="set-width" label="Line width" hint="Maximum width of the text column">
                <div class="aster-seg aster-seg-lg" role="radiogroup" aria-labelledby="set-width-label">
                  <For each={WIDTHS}>
                    {(w) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={props.settings.proseWidth === w.value}
                        classList={{ 'is-on': props.settings.proseWidth === w.value }}
                        onClick={() => set('proseWidth', w.value)}
                      >{w.label}</button>
                    )}
                  </For>
                </div>
              </Row>
            </div>
          </Show>

          <Show when={section() === 'editor'}>
            <h2>Editor</h2>
            <div class="aster-set-group">
              <Row id="set-ln" label="Line numbers" hint="Show line numbers in the gutter">
                <Toggle id="set-ln" labelledBy="set-ln-label" checked={props.settings.lineNumbers} onChange={(v) => set('lineNumbers', v)} />
              </Row>
              <Row id="set-tw" label="Typewriter scrolling" hint="Keep the line you are typing in the middle of the window">
                <Toggle id="set-tw" labelledBy="set-tw-label" checked={props.settings.typewriter} onChange={(v) => set('typewriter', v)} />
              </Row>
            </div>
          </Show>

          <Show when={section() === 'files'}>
            <h2>Files</h2>
            <div class="aster-set-group">
              <Row id="set-as" label="Auto-save" hint="Save files a second after you stop typing. New documents still need a first manual save.">
                <Toggle id="set-as" labelledBy="set-as-label" checked={props.settings.autoSave} onChange={(v) => set('autoSave', v)} />
              </Row>
            </div>
          </Show>

          <Show when={section() === 'plugins'}>
            <h2>Plugins</h2>
            <Show
              when={props.plugins.length > 0}
              fallback={<p class="aster-set-empty">No plugins installed. The full edition ships with math, diagrams, PDF export and more.</p>}
            >
              <div class="aster-set-group">
                <For each={props.plugins}>
                  {(p) => (
                    <div class="aster-set-row">
                      <div class="aster-set-text">
                        <div class="aster-set-label">{p.name} <span class="aster-set-ver">{p.version}</span></div>
                        <Show when={p.description}><div class="aster-set-hint">{p.description}</div></Show>
                      </div>
                      <span class="aster-badge">{p.source === 'Builtin' ? 'Built-in' : 'User'}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          <Show when={section() === 'shortcuts'}>
            <h2>Keyboard Shortcuts</h2>
            <For each={SHORTCUT_GROUPS}>
              {(g) => (
                <>
                  <h3>{g.title}</h3>
                  <div class="aster-set-group">
                    <For each={g.rows}>
                      {([what, keys]) => (
                        <div class="aster-set-row is-compact">
                          <div class="aster-set-label">{what}</div>
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
            <h2>About</h2>
            <div class="aster-set-group">
              <Row id="set-ver" label="Aster" hint="Markdown editor for people and agents">
                <span class="aster-set-ver">{props.version}</span>
              </Row>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
}
