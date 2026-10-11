// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { render } from 'solid-js/web';

const { platformDescriptor, pdfCall } = vi.hoisted(() => ({
  platformDescriptor: Object.getOwnPropertyDescriptor(navigator, 'platform'),
  pdfCall: vi.fn().mockResolvedValue(undefined),
}));

// This file exercises the actual Windows defaults without changing other files' platform.
vi.mock('../src/model', async (importOriginal) => {
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
  return await importOriginal();
});
vi.mock('../src/plugin-loader', () => ({
  initPluginLoader: vi.fn(),
  activateForTrigger: vi.fn(),
  asterApi: { commands: { call: pdfCall }, renderers: new Map() },
}));

import App from '../src/App';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/model';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.(); dispose = null;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  localStorage.clear();
  pdfCall.mockClear();
});
afterAll(() => {
  if (platformDescriptor) Object.defineProperty(navigator, 'platform', platformDescriptor);
  else Reflect.deleteProperty(navigator, 'platform');
});

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  dispose = render(() => <App />, root);
  return root;
}
function openSettings(root: HTMLElement) {
  (root.querySelector('[aria-label="Settings"]') as HTMLButtonElement).click();
}
function appearance(root: HTMLElement) {
  (root.querySelector('#aster-set-nav-appearance') as HTMLButtonElement).click();
  return root.querySelector('#set-menu-bar') as HTMLButtonElement;
}
function moreItems(root: HTMLElement) {
  (root.querySelector('.aster-tab-more') as HTMLButtonElement).click();
  return [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

describe('Windows menu preferences', () => {
  it('hides the menu for an existing settings file and preserves other settings', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: 'en', theme: 'dark', fontSize: 18 }));
    const root = mount();
    openSettings(root);
    expect(appearance(root).getAttribute('aria-checked')).toBe('false');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('18px');
  });

  it('persists both directions of the appearance toggle across reopening the app', () => {
    let root = mount();
    expect(DEFAULT_SETTINGS.showMenuBar).toBe(false);
    openSettings(root);
    const toggle = appearance(root);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).showMenuBar).toBe(true);
    dispose!(); dispose = null; root.remove();

    root = mount();
    openSettings(root);
    const restored = appearance(root);
    expect(restored.getAttribute('aria-checked')).toBe('true');
    restored.click();
    expect(restored.getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).showMenuBar).toBe(false);
  });

  it('restores the hidden Windows menu default after explicit confirmation', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, showMenuBar: true }));
    const root = mount();
    openSettings(root);
    expect(appearance(root).getAttribute('aria-checked')).toBe('true');
    (root.querySelector('#aster-set-nav-general') as HTMLButtonElement).click();
    (root.querySelector('#set-reset-label')!.closest('.aster-set-row')!.querySelector('button') as HTMLButtonElement).click();
    const dialog = root.querySelector('[role="alertdialog"]')!;
    expect(dialog).not.toBeNull();
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Restore Defaults')!.click();
    await Promise.resolve();
    expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    expect(appearance(root).getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).showMenuBar).toBe(false);
  });

  it('keeps PDF export reachable through the tab menu while the menu bar is hidden', async () => {
    const root = mount();
    const items = moreItems(root);
    const pdf = items.find((item) => item.querySelector('span')?.textContent === 'Export as PDF…');
    expect(pdf).toBeDefined();
    pdf!.click();
    await Promise.resolve();
    expect(pdfCall).toHaveBeenCalledExactlyOnceWith('pdf-export.print', {});
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(root.querySelectorAll('.aster-tab')).toHaveLength(1);
  });

  it('omits PDF on the settings tab and restores it when returning to the document', () => {
    const root = mount();
    openSettings(root);
    const settingsItems = moreItems(root);
    expect(settingsItems.map((item) => item.querySelector('span')!.textContent)).toEqual(['New blank tab', 'Open file…', 'Settings']);
    settingsItems[settingsItems.length - 1].click();
    (root.querySelectorAll('.aster-tab')[0] as HTMLElement).click();
    expect(moreItems(root).map((item) => item.querySelector('span')!.textContent)).toContain('Export as PDF…');
  });
});
