// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { EditorView } from '@codemirror/view';
import App from '../src/App';

let dispose: (() => void) | null = null;
afterEach(() => { dispose?.(); dispose = null; document.body.innerHTML = ''; });

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

  it('opens settings with the gear and closes on Escape', () => {
    const root = mount();
    (root.querySelector('[aria-label="Settings"]') as HTMLButtonElement).click();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    key('Escape', { key: 'Escape' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
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
