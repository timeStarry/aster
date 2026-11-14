type ShortcutEvent = Pick<KeyboardEvent,
  'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' |
  'isComposing' | 'keyCode' | 'getModifierState'>;

export type ShortcutAction =
  | 'new'
  | 'open'
  | 'openFolder'
  | 'quickOpen'
  | 'commandPalette'
  | 'save'
  | 'saveAs'
  | 'close'
  | 'toggleMode'
  | 'toggleSidebar'
  | 'settings'
  | 'find'
  | 'replace'
  | 'nextTab'
  | 'prevTab';

/** Preserve physical-key shortcuts; use logical keys only when code is missing. */
export function shortcutAction(e: ShortcutEvent, isMac: boolean): ShortcutAction | null {
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.getModifierState('AltGraph')) return null;

  let code = e.code;
  if (!code || code === 'Unidentified') {
    // Do not infer shifted punctuation (e.g. '?' or '<') or another layout's
    // physical position when only the character is available.
    switch (e.key.toLowerCase()) {
      case 'n': code = 'KeyN'; break;
      case 'o': code = 'KeyO'; break;
      case 'p': code = 'KeyP'; break;
      case 's': code = 'KeyS'; break;
      case 'w': code = 'KeyW'; break;
      case 'f': code = 'KeyF'; break;
      case 'h': code = 'KeyH'; break;
      case '/': code = 'Slash'; break;
      case '\\': code = 'Backslash'; break;
      case ',': code = 'Comma'; break;
      case 'tab': code = 'Tab'; break;
    }
  }

  if (e.ctrlKey && code === 'Tab') return e.shiftKey ? 'prevTab' : 'nextTab';
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.altKey && !e.shiftKey && code === 'KeyF') return 'replace';
  if (mod && !e.altKey) {
    switch (code) {
      case 'KeyN': return 'new';
      case 'KeyO': return e.shiftKey ? 'openFolder' : 'open';
      case 'KeyP': return e.shiftKey ? 'commandPalette' : 'quickOpen';
      case 'KeyS': return e.shiftKey ? 'saveAs' : 'save';
      case 'KeyW': return 'close';
      case 'Slash': return 'toggleMode';
      case 'Backslash': return e.shiftKey ? null : 'toggleSidebar';
      case 'Comma': return 'settings';
      case 'KeyF': return 'find';
      case 'KeyH': return !isMac && !e.shiftKey ? 'replace' : null;
    }
  }
  return null;
}
