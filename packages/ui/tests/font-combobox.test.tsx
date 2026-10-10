// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { FontCombobox, type InstalledFont } from '../src/FontCombobox';
import type { FontChoice } from '../src/model';

let dispose: (() => void) | null = null;
afterEach(() => { dispose?.(); dispose = null; document.body.innerHTML = ''; });

const FONTS: InstalledFont[] = [
  { family: 'Helvetica', mono: false },
  { family: 'Menlo', mono: true },
  { family: 'PingFang SC', localized: '苹方-简', mono: false },
  { family: 'JetBrains Mono', mono: true },
];

function mount(monoOnly: boolean) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const [value, setValue] = createSignal<FontChoice>({ stack: monoOnly ? 'mono' : 'serif' });
  dispose = render(() => (
    <FontCombobox id="f" labelledBy="l" value={value()} presets={monoOnly ? ['mono'] : ['serif', 'sans']}
      fonts={FONTS} monoOnly={monoOnly} onChange={setValue} />
  ), root);
  (root.querySelector('#f') as HTMLButtonElement).click();
  return { root, value };
}

const names = () => [...document.querySelectorAll('[role="option"] > span:first-child')].map((x) => x.textContent);

describe('FontCombobox', () => {
  it('lists only fixed-pitch fonts for code', () => {
    mount(true);
    expect(names()).toEqual(['System monospace', 'Menlo', 'JetBrains Mono']);
  });

  it('lists every font for text and filters by search, including localized names', () => {
    mount(false);
    expect(names()).toEqual(['Book serif', 'System sans-serif', 'Helvetica', 'Menlo', 'PingFang SC', 'JetBrains Mono']);
    const search = document.querySelector('.aster-combo-search') as HTMLInputElement;
    search.value = '苹方';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(names()[0]).toBe('PingFang SC');
  });

  it('keyboard: arrows move, Enter picks, Escape closes', () => {
    const { value } = mount(true);
    const search = document.querySelector('.aster-combo-search') as HTMLInputElement;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(value()).toEqual({ family: 'Menlo' });
    (document.querySelector('#f') as HTMLButtonElement).click();
    document.querySelector('.aster-combo-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
