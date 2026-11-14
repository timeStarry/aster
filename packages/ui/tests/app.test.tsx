// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { EditorView } from '@codemirror/view';
import App from '../src/App';
import { isWindows } from '../src/model';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.(); dispose = null;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  localStorage.clear();
});

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  dispose = render(() => <App />, root);
  return root;
}

const key = (code: string, opts: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...opts }));
const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

describe('App shell (v2 minimal chrome & modal settings)', () => {
  it('renders unified top bar, editor and breathing status bar with 3-way Live | Source | Read capsule', () => {
    const root = mount();
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(1);
    expect(root.querySelector('[aria-label="Toggle sidebar"]')).not.toBeNull();
    expect(root.querySelector('.cm-editor')).not.toBeNull();
    expect(root.querySelector('.aster-lp-heading')).not.toBeNull();
    expect(root.querySelector('.aster-lp-strong')).not.toBeNull();
    const seg = [...root.querySelectorAll('.aster-status .aster-seg button')].map((b) => b.textContent);
    expect(seg).toEqual(['Live', 'Source', 'Read']);
    // Status bar shows word count + reading time, without cluttering file path or line/col
    expect(root.querySelector('.aster-status')!.textContent).toContain('min read');
    expect(root.querySelector('.aster-status-path')).toBeNull();
  });

  it('new tab via shortcut and via + button; close removes it', async () => {
    const root = mount();
    key('KeyN', mod);
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(2);
    (root.querySelector('.aster-tab-add') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(3);
    const titles = [...root.querySelectorAll('.aster-tab-title')].map((t) => t.textContent);
    expect(titles).toEqual(['Untitled', 'Untitled 2', 'Untitled 3']);
    (root.querySelectorAll('.aster-tab-close')[2] as HTMLButtonElement).click();
    await Promise.resolve();
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(2);
  });

  it('handles key-only new, settings modal and document-only tab cycling', () => {
    const root = mount();
    expect(key('', { key: 'n', ...mod })).toBe(false);
    expect(key('', { key: 'N', ...mod })).toBe(false);
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(3);
    // Ctrl+Tab cycles strictly through document tabs (Settings is never a tab)
    expect(key('', { key: 'Tab', ctrlKey: true })).toBe(false);
    expect(root.querySelectorAll('.aster-tab')[0].getAttribute('aria-selected')).toBe('true');
    expect(key('', { key: 'Tab', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(root.querySelectorAll('.aster-tab')[2].getAttribute('aria-selected')).toBe('true');
  });

  it('does not cancel ordinary input or IME keys', () => {
    const root = mount();
    expect(key('', { key: 'n' })).toBe(true);
    expect(key('', { key: 'n', isComposing: true, ...mod })).toBe(true);
    expect(key('KeyN', { key: 'n', keyCode: 229, ...mod })).toBe(true);
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(1);
  });

  it('switches cleanly across Live, Source and Read modes', () => {
    const root = mount();
    const btns = () => [...root.querySelectorAll('.aster-status .aster-seg button')] as HTMLButtonElement[];
    // Read mode: rendered & non-editable
    btns()[2].click();
    expect(btns()[2].getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.aster-lp-heading')).not.toBeNull();
    expect(root.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('false');
    // Source mode: raw text & editable
    btns()[1].click();
    expect(root.querySelector('.aster-lp-heading')).toBeNull();
    expect(root.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('true');
    // Live mode: rendered & editable
    btns()[0].click();
    expect(root.querySelector('.aster-lp-heading')).not.toBeNull();
    expect(root.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('true');
  });

  it('opens Settings as a centered Modal Sheet keeping editor visible behind it, closing on Esc or ⌘W', () => {
    const root = mount();
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)!;
    view.dispatch({ changes: { from: 0, insert: 'kept ' }, selection: { anchor: 5 } });

    (root.querySelector('[aria-label="Settings"]') as HTMLButtonElement).click();
    expect(root.querySelector('.aster-settings-sheet')).not.toBeNull();
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(1); // No settings tab added!
    expect((root.querySelector('.aster-editor-host') as HTMLElement).hidden).toBe(false);

    // Escape closes the modal sheet
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(root.querySelector('.aster-settings-sheet')).toBeNull();

    // Reopen via ⌘, and close via ⌘W without closing the underlying document tab
    key('Comma', mod);
    expect(root.querySelector('.aster-settings-sheet')).not.toBeNull();
    key('KeyW', mod);
    expect(root.querySelector('.aster-settings-sheet')).toBeNull();
    expect(view.state.doc.toString().startsWith('kept ')).toBe(true);
    expect(view.state.selection.main.head).toBe(5);
  });

  it('applies all 4 built-in themes (Paper, Pure Light, Ink Dark, Midnight) and editor settings immediately', () => {
    const root = mount();
    key('Comma', mod);
    (root.querySelector('#aster-set-nav-appearance') as HTMLButtonElement).click();
    const cards = () => [...root.querySelectorAll('.aster-theme-card')] as HTMLButtonElement[];
    expect(cards().map((c) => c.textContent)).toEqual(['System', 'Paper', 'Pure Light', 'Ink Dark', 'Midnight']);

    for (const [label, attr] of [
      ['Paper', 'paper'],
      ['Pure Light', 'light'],
      ['Ink Dark', 'dark'],
      ['Midnight', 'midnight'],
    ] as const) {
      const btn = cards().find((b) => b.textContent === label)!;
      btn.click();
      expect(document.documentElement.getAttribute('data-theme')).toBe(attr);
      expect(btn.getAttribute('aria-checked')).toBe('true');
    }

    expect(root.querySelector('#set-menu-bar') !== null).toBe(isWindows);
    (root.querySelector('#aster-set-nav-editor') as HTMLButtonElement).click();
    const ln = root.querySelector('#set-ln') as HTMLButtonElement;
    expect(ln.getAttribute('aria-checked')).toBe('false');
    ln.click();
    expect(ln.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('font choices default to crisp sans-serif and support Sans, Serif, WenKai and Custom', () => {
    const root = mount();
    key('Comma', mod);
    (root.querySelector('#aster-set-nav-editor') as HTMLButtonElement).click();
    const style = document.documentElement.style;
    const presetBtns = () => [...root.querySelectorAll('[aria-labelledby="set-preset-label"] button')] as HTMLButtonElement[];
    expect(presetBtns().every((b) => b.disabled)).toBe(true);
    expect(style.getPropertyValue('--font-prose')).toBe('');

    (root.querySelector('#set-ft') as HTMLButtonElement).click(); // stop following theme
    expect(presetBtns().every((b) => !b.disabled)).toBe(true);
    expect(style.getPropertyValue('--font-prose')).toContain('sans-serif');

    presetBtns().find((b) => b.textContent === 'Serif')!.click();
    expect(style.getPropertyValue('--font-prose')).toContain('serif');

    presetBtns().find((b) => b.textContent === 'WenKai')!.click();
    expect(style.getPropertyValue('--font-prose')).toContain('LXGW WenKai');

    presetBtns().find((b) => b.textContent === 'Custom')!.click();
    const body = root.querySelector('#set-body') as HTMLButtonElement;
    expect(body).not.toBeNull();
    expect(root.querySelector('#set-code')).not.toBeNull();

    // Typing a custom font name works
    body.click();
    const search = document.querySelector('.aster-combo-search') as HTMLInputElement;
    search.value = 'My Font';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(style.getPropertyValue('--font-prose').startsWith('"My Font"')).toBe(true);

    (root.querySelector('#set-ft') as HTMLButtonElement).click(); // back to theme fonts
    expect(style.getPropertyValue('--font-prose')).toBe('');
    expect(root.querySelector('#set-body')).toBeNull();
  });

  it('switches the interface to Chinese and back', () => {
    const root = mount();
    key('Comma', mod);
    const sel = root.querySelector('#set-lang') as HTMLSelectElement;
    sel.value = 'zh';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(root.querySelector('.aster-set-title')!.textContent).toBe('设置');
    const tabTitles = [...root.querySelectorAll('.aster-tab-title')].map((x) => x.textContent);
    expect(tabTitles).toEqual(['未命名']);
    const seg = [...root.querySelectorAll('.aster-status .aster-seg button')].map((b) => b.textContent);
    expect(seg).toEqual(['实时', '源码', '阅览']);
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)!;
    expect(view.state.doc.toString()).toContain('欢迎使用 Aster');
    expect(view.state.phrase('Find')).toBe('查找');

    sel.value = 'en';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('.aster-set-title')!.textContent).toBe('Settings');
    expect(view.state.doc.toString()).toContain('Welcome to Aster');
  });

  it('new-tab menu offers blank tab, open and settings modal', () => {
    const root = mount();
    const more = root.querySelector('.aster-tab-more') as HTMLButtonElement;
    more.click();
    const items = [...root.querySelectorAll('[role="menuitem"]')].map((x) => x.querySelector('span')!.textContent);
    expect(items).toEqual(['New blank tab', 'Open file…', ...(isWindows ? ['Export as PDF…'] : []), 'Settings']);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    (root.querySelectorAll('[role="menuitem"]')[items.length - 1] as HTMLButtonElement).click();
    expect(root.querySelector('.aster-settings-sheet')).not.toBeNull();
    expect(root.querySelector('[role="menu"]')).toBeNull();
    (root.querySelector('.aster-tab-add') as HTMLButtonElement).click();
    expect([...root.querySelectorAll('.aster-tab-title')].map((x) => x.textContent)).toEqual(['Untitled', 'Untitled 2']);
  });

  it('closing a dirty draft tab asks before deleting draft', async () => {
    const root = mount();
    key('KeyN', mod);
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)!;
    view.dispatch({ changes: { from: 0, insert: 'draft' } });
    expect(root.querySelector('.aster-tab-close.is-dirty')).not.toBeNull();
    key('KeyW', mod);
    await Promise.resolve();
    const dlg = document.querySelector('[role="alertdialog"]');
    expect(dlg?.textContent).toContain('Save changes to “Untitled 2”');
    expect(dlg?.textContent).toContain('Delete Draft');
    const cancel = [...dlg!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    cancel.click();
    await Promise.resolve();
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(2);
  });
});
