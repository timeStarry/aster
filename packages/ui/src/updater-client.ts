import { createSignal } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from './i18n';

export interface ReleaseUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  htmlUrl: string;
  assetName: string | null;
  assetUrl: string | null;
  assetSize: number | null;
  checksumUrl: string | null;
}

export interface UpdateProgressEvent {
  stage: 'downloading' | 'verifying' | 'installing' | 'relaunch' | 'installer_launched' | 'opened_installer' | string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export interface UpdateInstallResult {
  action: 'relaunch' | 'installer_launched' | 'opened_installer' | string;
  targetPath: string;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UpdaterController {
  checking: () => boolean;
  installing: () => boolean;
  info: () => ReleaseUpdateInfo | null;
  progress: () => UpdateProgressEvent | null;
  installResult: () => UpdateInstallResult | null;
  error: () => string | null;
  hasUpdate: () => boolean;
  checkForUpdates: (silent?: boolean) => Promise<ReleaseUpdateInfo | null>;
  downloadAndInstall: () => Promise<void>;
  relaunchNow: () => Promise<void>;
  openReleaseUrl: (url?: string) => void;
}

export function createUpdaterController(opts: {
  onBeforeRelaunch: () => Promise<void>;
  flash: (msg: string, isError?: boolean) => void;
}): UpdaterController {
  const [checking, setChecking] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [info, setInfo] = createSignal<ReleaseUpdateInfo | null>(null);
  const [progress, setProgress] = createSignal<UpdateProgressEvent | null>(null);
  const [installResult, setInstallResult] = createSignal<UpdateInstallResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const errMsg = (e: unknown) => (e as { message?: string })?.message ?? String(e);

  async function checkForUpdates(silent = false): Promise<ReleaseUpdateInfo | null> {
    if (checking() || installing()) return info();
    setChecking(true);
    if (!silent) setError(null);
    try {
      const res = await invoke<ReleaseUpdateInfo>('update_check');
      setInfo(res);
      if (silent && res.hasUpdate) {
        opts.flash(t('notice.updateAvailable', { v: res.latestVersion }));
      }
      return res;
    } catch (e) {
      if (!silent) {
        setError(t('about.updateFailed', { err: errMsg(e) }));
      }
      return null;
    } finally {
      setChecking(false);
    }
  }

  async function downloadAndInstall(): Promise<void> {
    const cur = info();
    if (!cur || installing()) return;
    if (!cur.assetName || !cur.assetUrl) {
      openReleaseUrl(cur.htmlUrl);
      return;
    }
    setInstalling(true);
    setError(null);
    setInstallResult(null);
    setProgress({ stage: 'downloading', downloadedBytes: 0, totalBytes: cur.assetSize, percent: 0 });

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<UpdateProgressEvent>('aster://update-progress', (ev) => {
        setProgress(ev.payload);
      });
    } catch {
      // Event stream optional in test mocks
    }

    try {
      const res = await invoke<UpdateInstallResult>('update_download_and_install', {
        assetName: cur.assetName,
        assetUrl: cur.assetUrl,
        checksumUrl: cur.checksumUrl,
      });
      setInstallResult(res);
    } catch (e) {
      setError(t('about.updateFailed', { err: errMsg(e) }));
    } finally {
      unlisten?.();
      setInstalling(false);
    }
  }

  async function relaunchNow(): Promise<void> {
    try {
      await opts.onBeforeRelaunch();
    } catch {
      // Best-effort session flush
    }
    await invoke('update_relaunch');
  }

  function openReleaseUrl(url?: string): void {
    const target = url || info()?.htmlUrl || 'https://github.com/timeStarry/aster/releases';
    invoke('open_external_url', { url: target }).catch(() => {});
  }

  return {
    checking,
    installing,
    info,
    progress,
    installResult,
    error,
    hasUpdate: () => Boolean(info()?.hasUpdate),
    checkForUpdates,
    downloadAndInstall,
    relaunchNow,
    openReleaseUrl,
  };
}
