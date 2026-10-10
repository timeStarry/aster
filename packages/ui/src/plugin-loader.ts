import { createPluginApi, type PluginApiImpl } from './plugin-api-impl';

/** Minimal plugin description needed for frontend activation. */
export interface LoadablePlugin {
  id: string;
  activation: string[];
  /** Absolute path (or URL) to the plugin's frontend entry module. */
  frontend?: string;
}

type Resolve = (pluginId: string, path: string) => string;

export let asterApi: PluginApiImpl | null = null;

/**
 * One activation promise per plugin. Concurrent callers (e.g. two ```math
 * blocks rendering at once) must wait for the same load: marking a plugin as
 * "activated" before its module finished registering let the second caller
 * look up a renderer that did not exist yet and fall back for good.
 */
let activations = new Map<string, Promise<void>>();

function activate(plugin: LoadablePlugin, resolve: Resolve): Promise<void> {
  let p = activations.get(plugin.id);
  if (!p) {
    p = plugin.frontend && asterApi
      ? asterApi._activateModule(resolve(plugin.id, plugin.frontend), plugin.id)
      : Promise.resolve();
    activations.set(plugin.id, p);
  }
  return p;
}

/**
 * Initialize the plugin system. Call once on app startup.
 * Installs window.__aster, then activates onStartup plugins.
 */
export async function initPluginLoader(plugins: LoadablePlugin[], resolvePluginUrl: Resolve): Promise<void> {
  asterApi = createPluginApi();
  activations = new Map();
  (window as unknown as Record<string, unknown>)['__aster'] = asterApi;
  await Promise.all(plugins.filter((p) => p.activation.includes('onStartup')).map((p) => activate(p, resolvePluginUrl)));
}

/**
 * Activate plugins for a trigger (e.g. 'onCodeBlock:mermaid') and resolve
 * once all of them have finished loading. Safe to call concurrently.
 */
export async function activateForTrigger(trigger: string, plugins: LoadablePlugin[], resolvePluginUrl: Resolve): Promise<void> {
  if (!asterApi) return;
  await Promise.all(plugins.filter((p) => p.activation.includes(trigger)).map((p) => activate(p, resolvePluginUrl)));
}

export function getCodeBlockRenderer(lang: string) {
  return asterApi?.renderers.get(lang) ?? null;
}
