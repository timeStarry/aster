import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { FontChoice, FontStackId } from './model';
import { FONT_STACKS } from './model';
import { t, lang, type Key } from './i18n';

export interface InstalledFont {
  family: string;
  localized?: string;
  mono: boolean;
}

interface Option {
  key: string;
  choice: FontChoice;
  label: string;
  sub?: string;
  css: string;
  group: 'preset' | 'installed' | 'typed';
}

interface Props {
  id: string;
  labelledBy: string;
  value: FontChoice;
  presets: FontStackId[];
  /** Installed families to offer; null while they are still loading. */
  fonts: InstalledFont[] | null;
  /** Only list fixed-pitch families (code font picker). */
  monoOnly?: boolean;
  onChange: (c: FontChoice) => void;
}

const MAX_SHOWN = 200;

function choiceKey(c: FontChoice) {
  return 'stack' in c ? `s:${c.stack}` : `f:${c.family.toLowerCase()}`;
}

/**
 * Searchable font picker (ARIA combobox + listbox). Presets come first, then
 * installed families, each previewed in its own face. Typing a name that
 * isn't installed is allowed, so fonts loaded later still work.
 */
export function FontCombobox(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);
  let root!: HTMLDivElement;
  let input!: HTMLInputElement;
  let list!: HTMLUListElement;

  const currentLabel = () => {
    const v = props.value;
    if ('stack' in v) return t(FONT_STACKS[v.stack].label as Key);
    const f = props.fonts?.find((x) => x.family.toLowerCase() === v.family.toLowerCase());
    return f ? displayName(f) : v.family;
  };
  const currentCss = () => {
    const v = props.value;
    return 'stack' in v ? FONT_STACKS[v.stack].css : `"${v.family}"`;
  };

  function displayName(f: InstalledFont) {
    return lang() === 'zh' && f.localized ? f.localized : f.family;
  }

  const options = createMemo<Option[]>(() => {
    const q = query().trim().toLowerCase();
    const match = (...names: (string | undefined)[]) => !q || names.some((n) => n?.toLowerCase().includes(q));
    const out: Option[] = [];
    for (const id of props.presets) {
      const label = t(FONT_STACKS[id].label as Key);
      if (match(label, id)) out.push({ key: `s:${id}`, choice: { stack: id }, label, css: FONT_STACKS[id].css, group: 'preset' });
    }
    let shown = 0;
    for (const f of props.fonts ?? []) {
      if (props.monoOnly && !f.mono) continue;
      if (!match(f.family, f.localized)) continue;
      if (shown++ >= MAX_SHOWN) break;
      const label = displayName(f);
      out.push({
        key: `f:${f.family.toLowerCase()}`,
        choice: { family: f.family },
        label,
        sub: label !== f.family ? f.family : undefined,
        css: `"${f.family}"`,
        group: 'installed',
      });
    }
    const typed = query().trim();
    if (typed && !out.some((o) => o.label.toLowerCase() === typed.toLowerCase() || o.sub?.toLowerCase() === typed.toLowerCase())) {
      out.push({ key: `t:${typed}`, choice: { family: typed }, label: t('set.fontUseTyped', { name: typed }), css: `"${typed}"`, group: 'typed' });
    }
    return out;
  });

  function show() {
    setQuery('');
    setOpen(true);
    const i = options().findIndex((o) => o.key === choiceKey(props.value));
    setActive(Math.max(0, i));
    queueMicrotask(() => {
      input?.focus();
      scrollActive();
    });
  }
  function hide(refocus = true) {
    setOpen(false);
    if (refocus) root.querySelector<HTMLButtonElement>('.aster-combo-button')?.focus();
  }
  function choose(o: Option | undefined) {
    if (!o) return;
    props.onChange(o.choice);
    hide();
  }
  function scrollActive() {
    list?.querySelector<HTMLElement>(`[data-i="${active()}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }

  function onKey(e: KeyboardEvent) {
    const n = options().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(n - 1, i + 1)); scrollActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); scrollActive(); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); scrollActive(); }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); scrollActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(options()[active()]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
    else if (e.key === 'Tab') hide(false);
  }

  const onDocDown = (e: MouseEvent) => { if (open() && !root.contains(e.target as Node)) hide(false); };
  onMount(() => document.addEventListener('mousedown', onDocDown, true));
  onCleanup(() => document.removeEventListener('mousedown', onDocDown, true));

  const listId = `${props.id}-list`;
  const optId = (i: number) => `${props.id}-opt-${i}`;

  return (
    <div class="aster-combo" ref={root}>
      <button
        id={props.id}
        type="button"
        class="aster-combo-button"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-labelledby={`${props.labelledBy} ${props.id}`}
        onClick={() => (open() ? hide() : show())}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); } }}
      >
        <span class="aster-combo-value" style={{ 'font-family': currentCss() }}>{currentLabel()}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      <Show when={open()}>
        <div class="aster-combo-pop">
          <input
            ref={input}
            type="text"
            class="aster-text aster-combo-search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options().length ? optId(active()) : undefined}
            aria-label={t('set.fontSearch')}
            placeholder={t('set.fontSearch')}
            spellcheck={false}
            autocomplete="off"
            value={query()}
            onInput={(e) => { setQuery(e.currentTarget.value); setActive(0); }}
            onKeyDown={onKey}
          />
          <ul class="aster-combo-list" id={listId} role="listbox" ref={list} aria-label={t('set.fontSearch')}>
            <For each={options()}>
              {(o, i) => (
                <>
                  <Show when={i() === 0 || options()[i() - 1].group !== o.group}>
                    <li class="aster-combo-group" role="presentation">
                      {o.group === 'preset' ? t('set.fontPresets') : o.group === 'installed' ? t('set.fontInstalled') : ''}
                    </li>
                  </Show>
                  <li
                    id={optId(i())}
                    data-i={i()}
                    role="option"
                    class="aster-combo-opt"
                    classList={{ 'is-active': i() === active() }}
                    aria-selected={o.key === choiceKey(props.value)}
                    onMouseMove={() => setActive(i())}
                    onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                  >
                    <span style={{ 'font-family': o.css }}>{o.label}</span>
                    <Show when={o.sub}><span class="aster-combo-sub">{o.sub}</span></Show>
                  </li>
                </>
              )}
            </For>
            <Show when={props.fonts === null}>
              <li class="aster-combo-note" role="presentation">{t('set.fontLoading')}</li>
            </Show>
            <Show when={props.fonts !== null && options().length === 0}>
              <li class="aster-combo-note" role="presentation">{t('set.fontNoMatch')}</li>
            </Show>
          </ul>
        </div>
      </Show>
    </div>
  );
}
