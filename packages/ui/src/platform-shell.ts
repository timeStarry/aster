import { invoke } from '@tauri-apps/api/core';

export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'web';
export type WindowMaterial = 'liquid-glass' | 'vibrancy' | 'mica' | 'acrylic' | 'solid';
type NativeTheme = 'light' | 'dark' | 'system';
export interface ShellAppearance {
  platform: Exclude<DesktopPlatform, 'web'>;
  material: WindowMaterial;
}

/** Browser previews use the host's design language, with an opaque fallback. */
export function detectDesktopPlatform(platform = navigator.platform): DesktopPlatform {
  if (/Mac/i.test(platform)) return 'macos';
  if (/Win/i.test(platform)) return 'windows';
  if (/Linux|X11/i.test(platform)) return 'linux';
  return 'web';
}

/** Plugin themes declare color-scheme, so their native chrome matches too. */
export function resolvedColorScheme(root = document.documentElement): 'light' | 'dark' {
  const scheme = (getComputedStyle(root).colorScheme || '').trim();
  if (scheme === 'dark' || scheme === 'only dark') return 'dark';
  if (scheme === 'light' || scheme === 'only light') return 'light';
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Only the desktop shell knows about materials; the editor stays shared. */
export function createPlatformShell(native: boolean) {
  const root = document.documentElement;
  root.dataset.platform = detectDesktopPlatform();
  root.dataset.material = 'solid';
  root.dataset.native = String(native);
  root.dataset.windowActive = String(document.hasFocus());

  let disposed = false;
  let mounted = false;
  // Leaving the OS appearance unforced is essential for WKWebView's media
  // query to continue following system changes. Plugin themes stay explicit.
  const nativeTheme = (): NativeTheme => root.hasAttribute('data-theme') ? resolvedColorScheme(root) : 'system';
  let requestedTheme: NativeTheme = nativeTheme();
  let appliedTheme: NativeTheme | null = null;
  let requestedRevision = 0;
  let appliedRevision = -1;
  let pending: Promise<void> | null = null;
  const removers: (() => void)[] = [];

  const drain = async () => {
    // Serialize native calls: a slow earlier request must not override a
    // newer theme, or move the WebView between native material views twice.
    while (!disposed && (requestedTheme !== appliedTheme || requestedRevision !== appliedRevision)) {
      const theme = requestedTheme;
      const revision = requestedRevision;
      try {
        const appearance = await invoke<ShellAppearance>('configure_shell', { theme });
        if (disposed) return;
        root.dataset.platform = appearance.platform;
        root.dataset.material = appearance.material;
      } catch (error) {
        if (disposed) return;
        root.dataset.material = 'solid';
        console.error('[aster] window appearance failed:', error);
      }
      appliedTheme = theme;
      appliedRevision = revision;
    }
  };

  const syncTheme = (force = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    requestedTheme = nativeTheme();
    root.dataset.colorScheme = resolvedColorScheme(root);
    if (force) requestedRevision++;
    if (!native) return Promise.resolve();
    if (!pending && (requestedTheme !== appliedTheme || requestedRevision !== appliedRevision)) {
      pending = drain().finally(() => {
        pending = null;
        // A media/focus event can arrive after drain's last check but before
        // this microtask runs. Keep awaiting callers attached to that update.
        if (!disposed && (requestedTheme !== appliedTheme || requestedRevision !== appliedRevision)) {
          return syncTheme();
        }
      });
    }
    return pending ?? Promise.resolve();
  };

  const setActive = () => {
    root.dataset.windowActive = 'true';
    // Also refresh native accessibility preferences when returning from
    // System Settings, including WebViews without the transparency query.
    if (native) void syncTheme(true);
  };
  const setInactive = () => { root.dataset.windowActive = 'false'; };

  return {
    syncTheme,
    setWindowActive(active: boolean) {
      if (disposed) return;
      if (active) setActive();
      else setInactive();
    },
    mount() {
      if (mounted || disposed) return;
      mounted = true;
      window.addEventListener('focus', setActive);
      window.addEventListener('blur', setInactive);
      removers.push(() => {
        window.removeEventListener('focus', setActive);
        window.removeEventListener('blur', setInactive);
      });
      const onThemeLoad = (event: Event) => {
        if (event.target instanceof HTMLLinkElement && event.target.id === 'aster-plugin-theme') {
          // Stylesheet load is not tied to RAF scheduling in inactive windows.
          void syncTheme();
        }
      };
      document.addEventListener('load', onThemeLoad, true);
      removers.push(() => document.removeEventListener('load', onThemeLoad, true));
      if (typeof matchMedia === 'function') {
        const dark = matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => { void syncTheme(!root.hasAttribute('data-theme')); };
        dark.addEventListener('change', onChange);
        removers.push(() => dark.removeEventListener('change', onChange));
        const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
        const onTransparencyChange = () => { void syncTheme(true); };
        transparency.addEventListener('change', onTransparencyChange);
        removers.push(() => transparency.removeEventListener('change', onTransparencyChange));
      }
      void syncTheme();
    },
    dispose() {
      disposed = true;
      removers.forEach((remove) => remove());
    },
  };
}
