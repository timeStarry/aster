// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createPlatformShell, resolvedColorScheme, type ShellAppearance } from '../src/platform-shell';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const configure = vi.mocked(invoke);
const shells: ReturnType<typeof createPlatformShell>[] = [];
function shell(native = true) {
  const s = createPlatformShell(native);
  shells.push(s);
  return s;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

afterEach(() => {
  shells.splice(0).forEach((s) => s.dispose());
  configure.mockReset();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  document.getElementById('aster-plugin-theme')?.remove();
  for (const key of ['platform', 'material', 'native', 'windowActive', 'colorScheme']) {
    delete document.documentElement.dataset[key];
  }
});

describe('platform shell', () => {
  it('keeps browser previews opaque and never calls desktop IPC', async () => {
    document.documentElement.style.colorScheme = 'dark';
    const s = shell(false);
    s.mount();
    await s.syncTheme();
    expect(document.documentElement.dataset).toMatchObject({ native: 'false', material: 'solid', colorScheme: 'dark' });
    expect(configure).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('focus'));
    expect(document.documentElement.dataset.windowActive).toBe('true');
    window.dispatchEvent(new Event('blur'));
    expect(document.documentElement.dataset.windowActive).toBe('false');
  });

  it('uses the native material result and synchronizes a plugin theme’s color scheme', async () => {
    document.documentElement.dataset.theme = 'aster.theme-dark';
    document.documentElement.style.colorScheme = 'dark';
    configure.mockResolvedValue({ platform: 'windows', material: 'mica' });
    await shell().syncTheme();
    expect(configure).toHaveBeenCalledWith('configure_shell', { theme: 'dark' });
    expect(document.documentElement.dataset).toMatchObject({ platform: 'windows', material: 'mica', colorScheme: 'dark' });
  });

  it('serializes fast theme changes and applies the latest theme last', async () => {
    const light = deferred<ShellAppearance>();
    const dark = deferred<ShellAppearance>();
    configure.mockReturnValueOnce(light.promise).mockReturnValueOnce(dark.promise);
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';
    const s = shell();
    const first = s.syncTheme();
    document.documentElement.style.colorScheme = 'dark';
    const last = s.syncTheme();
    expect(configure).toHaveBeenCalledTimes(1);
    light.resolve({ platform: 'macos', material: 'liquid-glass' });
    await Promise.resolve();
    expect(configure).toHaveBeenNthCalledWith(2, 'configure_shell', { theme: 'dark' });
    dark.resolve({ platform: 'macos', material: 'liquid-glass' });
    await Promise.all([first, last]);
    await s.syncTheme();
    expect(configure).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.colorScheme).toBe('dark');
  });

  it('does not apply a late native response after the shell is disposed', async () => {
    const request = deferred<ShellAppearance>();
    configure.mockReturnValueOnce(request.promise);
    const s = shell();
    const pending = s.syncTheme();
    s.dispose();
    request.resolve({ platform: 'macos', material: 'liquid-glass' });
    await pending;
    expect(document.documentElement.dataset.material).toBe('solid');
  });

  it('does not lose a theme update between completion and pending cleanup', async () => {
    const request = deferred<ShellAppearance>();
    configure.mockReturnValueOnce(request.promise)
      .mockResolvedValue({ platform: 'macos', material: 'liquid-glass' });
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';
    const s = shell();
    const pending = s.syncTheme();
    request.resolve({ platform: 'macos', material: 'liquid-glass' });
    queueMicrotask(() => {
      document.documentElement.style.colorScheme = 'dark';
      void s.syncTheme(true);
    });
    await pending;
    expect(configure).toHaveBeenCalledTimes(2);
    expect(configure).toHaveBeenLastCalledWith('configure_shell', { theme: 'dark' });
  });

  it('retains readable opaque chrome when desktop appearance fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    configure.mockRejectedValueOnce(new Error('material unavailable'));
    await shell().syncTheme();
    expect(document.documentElement.dataset.material).toBe('solid');
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('clears the native override when returning from dark to system, even when both look dark', async () => {
    document.documentElement.style.colorScheme = 'dark';
    document.documentElement.dataset.theme = 'dark';
    configure.mockResolvedValue({ platform: 'macos', material: 'liquid-glass' });
    const s = shell();
    await s.syncTheme();
    document.documentElement.removeAttribute('data-theme');
    await s.syncTheme();
    expect(configure).toHaveBeenNthCalledWith(1, 'configure_shell', { theme: 'dark' });
    expect(configure).toHaveBeenNthCalledWith(2, 'configure_shell', { theme: 'system' });
    expect(document.documentElement.dataset.colorScheme).toBe('dark');
  });

  it('synchronizes an asynchronously loaded plugin stylesheet without waiting for animation frames', async () => {
    document.documentElement.dataset.theme = 'aster.theme-dark';
    document.documentElement.style.colorScheme = 'light';
    configure.mockResolvedValue({ platform: 'macos', material: 'liquid-glass' });
    const s = shell();
    s.mount();
    await s.syncTheme();
    const link = document.createElement('link');
    link.id = 'aster-plugin-theme';
    document.head.appendChild(link);
    document.documentElement.style.colorScheme = 'dark';
    link.dispatchEvent(new Event('load'));
    await s.syncTheme();
    expect(configure).toHaveBeenNthCalledWith(1, 'configure_shell', { theme: 'light' });
    expect(configure).toHaveBeenNthCalledWith(2, 'configure_shell', { theme: 'dark' });
  });

  it('responds to system appearance changes and removes its listeners on disposal', async () => {
    const media = new EventTarget();
    const transparency = new EventTarget();
    let dark = false;
    vi.stubGlobal('matchMedia', (query: string) => {
      const target = query.includes('transparency') ? transparency : media;
      return {
        get matches() { return dark; },
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
      };
    });
    configure.mockResolvedValue({ platform: 'windows', material: 'mica' });
    const s = shell();
    s.mount();
    await s.syncTheme();
    dark = true;
    media.dispatchEvent(new Event('change'));
    await s.syncTheme();
    expect(configure).toHaveBeenLastCalledWith('configure_shell', { theme: 'system' });
    expect(resolvedColorScheme()).toBe('dark');
    configure.mockResolvedValue({ platform: 'windows', material: 'solid' });
    transparency.dispatchEvent(new Event('change'));
    await s.syncTheme();
    expect(configure).toHaveBeenCalledTimes(3);
    expect(document.documentElement.dataset.material).toBe('solid');
    s.dispose();
    dark = false;
    media.dispatchEvent(new Event('change'));
    await Promise.resolve();
    transparency.dispatchEvent(new Event('change'));
    expect(configure).toHaveBeenCalledTimes(3);
  });
});
