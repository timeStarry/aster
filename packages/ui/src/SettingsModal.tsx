import { For, Show, onMount, onCleanup } from 'solid-js';
import type { Settings, PluginTheme } from './model';
import { MOD, ALT, SHIFT } from './model';

export interface PluginRow {
  id: string;
  name: string;
  version: string;
  source: string;
}

interface Props {
  settings: Settings;
  plugins: PluginRow[];
  themes: PluginTheme[];
  onChange: (s: Settings) => void;
  onClose: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['Bold / Italic / Inline code', `${MOD}B · ${MOD}I · ${MOD}E`],
  ['Strikethrough', `${MOD}${SHIFT}X`],
  ['Link', `${MOD}K`],
  ['Heading 1–6 / Paragraph', `${MOD}1–6 · ${MOD}0`],
  ['Bullet / Numbered / Task list', `${MOD}${SHIFT}8 · 7 · 9`],
  ['Quote', `${MOD}${SHIFT}.`],
  ['Code block / Table', `${MOD}${ALT}C · ${MOD}${ALT}T`],
  ['Find / Replace', `${MOD}F`],
  ['Toggle Live / Source', `${MOD}/`],
  ['Toggle read-only', `${MOD}${ALT}L`],
  ['New / Open / Save / Save as', `${MOD}N · ${MOD}O · ${MOD}S · ${MOD}${SHIFT}S`],
  ['Close tab / Next tab', `${MOD}W · Ctrl+Tab`],
];

export function SettingsModal(props: Props) {
  let first: HTMLSelectElement | undefined;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => props.onChange({ ...props.settings, [k]: v });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); props.onClose(); } };
  onMount(() => { first?.focus(); window.addEventListener('keydown', onKey, true); });
  onCleanup(() => window.removeEventListener('keydown', onKey, true));

  return (
    <div class="aster-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="aster-modal" role="dialog" aria-modal="true" aria-labelledby="aster-settings-title">
        <h2 id="aster-settings-title">Settings</h2>

        <div class="aster-field">
          <label for="s-theme">Theme</label>
          <select id="s-theme" ref={first} value={props.settings.theme}
            onChange={(e) => set('theme', e.currentTarget.value)}>
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <For each={props.themes}>{(t) => <option value={t.id}>{t.name}</option>}</For>
          </select>
        </div>
        <div class="aster-field">
          <label for="s-font">Font size</label>
          <input id="s-font" type="number" min="12" max="28" value={props.settings.fontSize}
            onChange={(e) => {
              const n = Math.round(Number(e.currentTarget.value));
              if (n >= 12 && n <= 28) set('fontSize', n);
            }} />
        </div>
        <div class="aster-field">
          <label for="s-width">Line width</label>
          <select id="s-width" value={String(props.settings.proseWidth)}
            onChange={(e) => set('proseWidth', Number(e.currentTarget.value))}>
            <option value="640">Narrow</option>
            <option value="760">Comfortable</option>
            <option value="920">Wide</option>
            <option value="100000">Full window</option>
          </select>
        </div>
        <div class="aster-field">
          <label for="s-ln">Line numbers</label>
          <input id="s-ln" type="checkbox" checked={props.settings.lineNumbers}
            onChange={(e) => set('lineNumbers', e.currentTarget.checked)} />
        </div>
        <div class="aster-field">
          <label for="s-tw">Typewriter scrolling</label>
          <input id="s-tw" type="checkbox" checked={props.settings.typewriter}
            onChange={(e) => set('typewriter', e.currentTarget.checked)} />
        </div>
        <div class="aster-field">
          <label for="s-as">Auto-save files</label>
          <input id="s-as" type="checkbox" checked={props.settings.autoSave}
            onChange={(e) => set('autoSave', e.currentTarget.checked)} />
        </div>

        <h2 style={{ 'margin-top': '20px' }}>Plugins</h2>
        <Show when={props.plugins.length > 0} fallback={<p style={{ 'font-size': '12.5px', color: 'var(--fg-faint)' }}>No plugins installed.</p>}>
          <ul class="aster-plugin-list">
            <For each={props.plugins}>
              {(p) => (
                <li>
                  <span>{p.name} <span class="src">{p.version}</span></span>
                  <span class="src">{p.source === 'Builtin' ? 'Built-in' : 'User'}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <h2 style={{ 'margin-top': '20px' }}>Keyboard shortcuts</h2>
        <ul class="aster-plugin-list">
          <For each={SHORTCUTS}>
            {([what, keys]) => <li><span>{what}</span><span class="src">{keys}</span></li>}
          </For>
        </ul>

        <div class="aster-actions">
          <button class="aster-btn primary" onClick={() => props.onClose()}>Done</button>
        </div>
      </div>
    </div>
  );
}
