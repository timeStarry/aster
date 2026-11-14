// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'solid-js/web';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

import { SettingsPane } from '../src/SettingsPane';
import { DEFAULT_SETTINGS } from '../src/model';
import { createUpdaterController } from '../src/updater-client';
import { applyLanguage } from '../src/i18n';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = '';
  invokeMock.mockReset();
});

describe('About page GitHub Releases auto-updater', () => {
  it('checks GitHub Releases, displays update card, installs, and flushes session before relaunch', async () => {
    applyLanguage('zh');
    let flushedBeforeRelaunch = false;

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'update_check') {
        return {
          currentVersion: '0.1.0-alpha.8',
          latestVersion: '0.1.0-alpha.9',
          hasUpdate: true,
          releaseName: 'Aster v0.1.0-alpha.9',
          releaseNotes: '- 修复选区左侧多余留白\n- 新增关于页自动更新',
          publishedAt: '2026-11-14T00:00:00Z',
          htmlUrl: 'https://github.com/timeStarry/aster/releases/tag/v0.1.0-alpha.9',
          assetName: 'Aster_0.1.0-alpha.9_aarch64.dmg',
          assetUrl: 'https://github.com/timeStarry/aster/releases/download/v0.1.0-alpha.9/Aster_0.1.0-alpha.9_aarch64.dmg',
          assetSize: 6186598,
          checksumUrl: 'https://github.com/timeStarry/aster/releases/download/v0.1.0-alpha.9/SHA256SUMS-aarch64-apple-darwin.txt',
        };
      }
      if (cmd === 'update_download_and_install') {
        return { action: 'relaunch', targetPath: '/Applications/Aster.app' };
      }
      if (cmd === 'update_relaunch') {
        return undefined;
      }
      return undefined;
    });

    const updater = createUpdaterController({
      onBeforeRelaunch: async () => {
        flushedBeforeRelaunch = true;
      },
      flash: () => {},
    });

    const root = document.createElement('div');
    document.body.appendChild(root);
    dispose = render(
      () => (
        <SettingsPane
          settings={DEFAULT_SETTINGS}
          plugins={[]}
          themes={[]}
          fonts={[]}
          version="0.1.0-alpha.8"
          updater={updater}
          initialSection="about"
          onChange={() => {}}
          onExport={() => {}}
          onImport={() => {}}
          onReset={() => {}}
          onOpenRepo={() => {}}
        />
      ),
      root,
    );

    // 1. Click "检查更新"
    const checkBtn = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('检查更新'))!;
    expect(checkBtn).toBeDefined();
    checkBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(root.textContent).toContain('发现新版本 v0.1.0-alpha.9');
    expect(root.textContent).toContain('修复选区左侧多余留白');
    expect(root.querySelector('.aster-nav-dot')).not.toBeNull();

    // 2. Click "立即下载并更新（5.9 MB）"
    const dlBtn = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('立即下载并更新'))!;
    expect(dlBtn.textContent).toContain('5.9 MB');
    dlBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(invokeMock).toHaveBeenCalledWith('update_download_and_install', {
      assetName: 'Aster_0.1.0-alpha.9_aarch64.dmg',
      assetUrl: 'https://github.com/timeStarry/aster/releases/download/v0.1.0-alpha.9/Aster_0.1.0-alpha.9_aarch64.dmg',
      checksumUrl: 'https://github.com/timeStarry/aster/releases/download/v0.1.0-alpha.9/SHA256SUMS-aarch64-apple-darwin.txt',
    });
    expect(root.textContent).toContain('更新已安装就绪');

    // 3. Click "立即重启生效"
    const restartBtn = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('立即重启生效'))!;
    restartBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(flushedBeforeRelaunch).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('update_relaunch');
  });
});
