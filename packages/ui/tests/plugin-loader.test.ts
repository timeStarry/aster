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
