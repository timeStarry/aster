// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { EditorView } from '@codemirror/view';
import App from '../src/App';

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

describe('App shell', () => {
  it('renders tabs, editor and status bar with live preview applied', () => {
    const root = mount();
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(1);
    expect(root.querySelector('.cm-editor')).not.toBeNull();
    expect(root.querySelector('.aster-lp-heading')).not.toBeNull();
    expect(root.querySelector('.aster-lp-strong')).not.toBeNull();
    const seg = [...root.querySelectorAll('.aster-seg button')].map((b) => b.textContent);
    expect(seg).toEqual(['Live', 'Source']);
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

  it('lock is independent of live/source', () => {
    const root = mount();
    const lock = root.querySelector('[aria-label="Read-only"]') as HTMLButtonElement;
    lock.click();
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('false');
    (root.querySelectorAll('.aster-seg button')[1] as HTMLButtonElement).click();
    expect(root.querySelector('.aster-lp-heading')).toBeNull(); // source mode
    expect(root.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('false');
    lock.click();
    expect(root.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('true');
  });

  it('settings opens as a single tab and keeps the editor state', () => {
    const root = mount();
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)!;
    view.dispatch({ changes: { from: 0, insert: 'kept ' }, selection: { anchor: 5 } });

    (root.querySelector('[aria-label="Settings"]') as HTMLButtonElement).click();
    key('Comma', mod); // second open focuses the same tab
    const settingsTabs = root.querySelectorAll('.aster-tab-settings');
    expect(settingsTabs).toHaveLength(1);
    expect(settingsTabs[0].getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('.aster-settings')).not.toBeNull();
    expect((root.querySelector('.aster-editor-host') as HTMLElement).hidden).toBe(true);
    // Editor-only status items are hidden on the settings tab.
    expect(root.querySelector('.aster-seg[aria-label="Editor mode"]')).toBeNull();

    key('KeyW', mod);
    expect(root.querySelector('.aster-tab-settings')).toBeNull();
    expect((root.querySelector('.aster-editor-host') as HTMLElement).hidden).toBe(false);
    expect(view.state.doc.toString().startsWith('kept ')).toBe(true);
    expect(view.state.selection.main.head).toBe(5);
  });

  it('settings tab is part of tab cycling and stays last', () => {
    const root = mount();
    key('Comma', mod);
    key('KeyN', mod);
    const titles = [...root.querySelectorAll('.aster-tab-title')].map((t) => t.textContent);
    expect(titles).toEqual(['Untitled', 'Untitled 2', 'Settings']);
    key('Tab', { ctrlKey: true });
    expect(root.querySelector('.aster-tab-settings')!.getAttribute('aria-selected')).toBe('true');
    key('Tab', { ctrlKey: true });
    expect(root.querySelectorAll('.aster-tab')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('settings controls apply immediately', () => {
    const root = mount();
    key('Comma', mod);
    (root.querySelector('#aster-set-nav-appearance') as HTMLButtonElement).click();
    const dark = [...root.querySelectorAll('.aster-theme-card')].find((b) => b.textContent === 'Dark') as HTMLButtonElement;
    dark.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(dark.getAttribute('aria-checked')).toBe('true');
    (root.querySelector('#aster-set-nav-editor') as HTMLButtonElement).click();
    const ln = root.querySelector('#set-ln') as HTMLButtonElement;
    expect(ln.getAttribute('aria-checked')).toBe('false');
    ln.click();
    expect(ln.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('font choices are locked while following the theme', () => {
    const root = mount();
    key('Comma', mod);
    (root.querySelector('#aster-set-nav-editor') as HTMLButtonElement).click();
    const style = document.documentElement.style;
    const presetBtns = () => [...root.querySelectorAll('[aria-labelledby="set-preset-label"] button')] as HTMLButtonElement[];
    expect(presetBtns().every((b) => b.disabled)).toBe(true);
    expect(style.getPropertyValue('--font-prose')).toBe('');

    (root.querySelector('#set-ft') as HTMLButtonElement).click(); // stop following theme
    expect(presetBtns().every((b) => !b.disabled)).toBe(true);
    expect(style.getPropertyValue('--font-prose')).toContain('serif');

    presetBtns().find((b) => b.textContent === 'Sans-serif')!.click();
    expect(style.getPropertyValue('--font-prose')).toContain('sans-serif');
    expect(root.querySelector('#set-body')).toBeNull(); // pickers only for Custom

    presetBtns().find((b) => b.textContent === 'Custom')!.click();
    const body = root.querySelector('#set-body') as HTMLSelectElement;
    expect(body).not.toBeNull();
    expect(root.querySelector('#set-code')).not.toBeNull();
    body.value = 'wenkai';
    body.dispatchEvent(new Event('change', { bubbles: true }));
    expect(style.getPropertyValue('--font-prose')).toContain('LXGW WenKai');

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
    expect(tabTitles).toEqual(['未命名', '设置']);
    // Untouched welcome document follows the language.
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)!;
    expect(view.state.doc.toString()).toContain('欢迎使用 Aster');
    expect(view.state.phrase('Find')).toBe('查找');

    sel.value = 'en';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('.aster-set-title')!.textContent).toBe('Settings');
    expect(view.state.doc.toString()).toContain('Welcome to Aster');
  });

  it('closing a dirty tab asks before discarding', async () => {
    const root = mount();
    key('KeyN', mod);
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)!;
    view.dispatch({ changes: { from: 0, insert: 'draft' } });
    expect(root.querySelector('.aster-tab-close.is-dirty')).not.toBeNull();
    key('KeyW', mod);
    await Promise.resolve();
    const dlg = document.querySelector('[role="alertdialog"]');
    expect(dlg?.textContent).toContain('Save changes to “Untitled 2”');
    const cancel = [...dlg!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    cancel.click();
    await Promise.resolve();
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(2);
  });
});
