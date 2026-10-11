import { describe, it, expect } from 'vitest';
import { shortcutAction } from '../src/shortcuts';

type ShortcutEvent = Parameters<typeof shortcutAction>[0];
const event = (overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  code: '', key: '', ctrlKey: false, metaKey: false, shiftKey: false,
  altKey: false, isComposing: false, keyCode: 0, getModifierState: () => false,
  ...overrides,
});

describe('global shortcuts', () => {
  it.each([
    ['KeyN', 'n', 'new'], ['KeyO', 'o', 'open'], ['KeyS', 's', 'save'],
    ['KeyW', 'w', 'close'], ['Slash', '/', 'toggleMode'],
    ['Comma', ',', 'settings'], ['KeyF', 'f', 'find'],
  ])('matches %s by code and by key when code is unavailable', (code, key, action) => {
    for (const isMac of [false, true]) {
      const mod = isMac ? { metaKey: true } : { ctrlKey: true };
      expect(shortcutAction(event({ code, ...mod }), isMac)).toBe(action);
      expect(shortcutAction(event({ key, ...mod }), isMac)).toBe(action);
      expect(shortcutAction(event({ code: 'Unidentified', key: key.toUpperCase(), ...mod }), isMac)).toBe(action);
    }
  });

  it('keeps shifted save, lock and Ctrl+Tab on both platforms', () => {
    for (const isMac of [false, true]) {
      const mod = isMac ? { metaKey: true } : { ctrlKey: true };
      for (const code of ['', 'KeyS']) {
        expect(shortcutAction(event({ code, key: 'S', shiftKey: true, ...mod }), isMac)).toBe('saveAs');
      }
      for (const code of ['', 'KeyL']) {
        expect(shortcutAction(event({ code, key: 'l', altKey: true, ...mod }), isMac)).toBe('toggleLock');
      }
      for (const code of ['', 'Tab']) {
        expect(shortcutAction(event({ code, key: 'Tab', ctrlKey: true }), isMac)).toBe('nextTab');
        expect(shortcutAction(event({ code, key: 'Tab', ctrlKey: true, shiftKey: true }), isMac)).toBe('prevTab');
      }
    }
    expect(shortcutAction(event({ key: 'n', ctrlKey: true }), true)).toBeNull();
    expect(shortcutAction(event({ key: 'n', metaKey: true }), false)).toBeNull();
  });

  it('preserves physical positions and does not reinterpret other layout keys', () => {
    expect(shortcutAction(event({ code: 'KeyN', key: 's', ctrlKey: true }), false)).toBe('new');
    expect(shortcutAction(event({ code: 'Slash', key: '?', ctrlKey: true, shiftKey: true }), false)).toBe('toggleMode');
    expect(shortcutAction(event({ code: 'Comma', key: '<', ctrlKey: true, shiftKey: true }), false)).toBe('settings');
    for (const [code, key] of [['Digit7', '/'], ['Semicolon', ','], ['KeyM', 'n'], ['', '?'], ['', '<']]) {
      expect(shortcutAction(event({ code, key, ctrlKey: true }), false)).toBeNull();
    }
  });

  it('ignores ordinary typing and unrelated modified keys', () => {
    for (const key of ['n', '/', ',', 'Tab', '中', 'Dead', 'Unidentified', '']) {
      expect(shortcutAction(event({ key }), false)).toBeNull();
    }
    expect(shortcutAction(event({ code: 'KeyN', key: 'n' }), false)).toBeNull();
    expect(shortcutAction(event({ key: 'n', ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(shortcutAction(event({ key: '1', ctrlKey: true }), false)).toBeNull();
  });

  it('ignores IME and AltGraph on both code and key paths', () => {
    const guards: Partial<ShortcutEvent>[] = [
      { isComposing: true }, { keyCode: 229 }, { key: 'Process' },
      { getModifierState: (name) => name === 'AltGraph' },
    ];
    for (const code of ['', 'KeyN']) {
      for (const guard of guards) {
        expect(shortcutAction(event({ code, key: 'n', ctrlKey: true, ...guard }), false)).toBeNull();
      }
    }
    expect(shortcutAction(event({ code: 'KeyL', key: 'l', ctrlKey: true, altKey: true,
      getModifierState: (name) => name === 'AltGraph' }), false)).toBeNull();
    expect(shortcutAction(event({ key: 'Tab', ctrlKey: true,
      getModifierState: (name) => name === 'AltGraph' }), false)).toBeNull();
  });
});
