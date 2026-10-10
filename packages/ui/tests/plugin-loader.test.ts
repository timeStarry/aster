import { describe, it, expect } from 'vitest';
import { createPluginApi } from '../src/plugin-api-impl';

describe('PluginApiImpl', () => {
  it('registers and retrieves a renderer', () => {
    const api = createPluginApi();
    api.renderers.register('mermaid', async (src) => `<svg>${src}</svg>`);
    const r = api.renderers.get('mermaid');
    expect(r).not.toBeNull();
  });

  it('renderer not found returns null', () => {
    const api = createPluginApi();
    expect(api.renderers.get('nonexistent')).toBeNull();
  });

  it('registers and calls a command', async () => {
    const api = createPluginApi();
    api.commands.register('mermaid.exportSvg', async ({ source }) => ({ svg: `<svg>${source}</svg>` }));
    const result = await api.commands.call('mermaid.exportSvg', { source: 'graph LR' }) as { svg: string };
    expect(result.svg).toContain('graph LR');
  });

  it('failed plugin activation is isolated', async () => {
    const api = createPluginApi();
    // Simulate loading a plugin that throws on activation — should not propagate
    await api._activateModule('data:application/javascript,throw new Error("bad plugin")', 'test.bad');
    // Other registrations still work after a failed activation
    api.renderers.register('ok', async () => '<p>ok</p>');
    expect(api.renderers.get('ok')).not.toBeNull();
  });
});

describe('plugin loader', () => {
  it('concurrent triggers wait for the same load (no fallback race)', async () => {
    const { initPluginLoader, activateForTrigger, asterApi: _ } = await import('../src/plugin-loader');
    const loader = await import('../src/plugin-loader');
    await initPluginLoader([], (_id, p) => p);
    const api = loader.asterApi!;
    let loads = 0;
    let finish!: () => void;
    api._activateModule = () => {
      loads++;
      // Simulates a module that registers its renderer only after a delay.
      return new Promise<void>((r) => { finish = () => { api.renderers.register('math', async (s) => `<b>${s}</b>`); r(); }; });
    };
    const plugins = [{ id: 'aster.math', activation: ['onCodeBlock:math'], frontend: '/x/index.js' }];
    const first = activateForTrigger('onCodeBlock:math', plugins, (_id, p) => p);
    const second = activateForTrigger('onCodeBlock:math', plugins, (_id, p) => p);
    let secondDone = false;
    void second.then(() => { secondDone = true; });
    await Promise.resolve();
    expect(secondDone).toBe(false); // must not resolve before the module registered
    finish();
    await Promise.all([first, second]);
    expect(loads).toBe(1);
    expect(api.renderers.get('math')).not.toBeNull();
  });
});
