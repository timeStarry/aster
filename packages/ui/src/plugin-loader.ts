import { createPluginApi, type PluginApiImpl } from './plugin-api-impl';

/** Minimal plugin description needed for frontend activation. */
export interface LoadablePlugin {
  id: string;
  activation: string[];
  /** Absolute path (or URL) to the plugin's frontend entry module. */
  frontend?: string;
}

export let asterApi: PluginApiImpl | null = null;
let activated = new Set<string>();

/**
 * Initialize the plugin system. Call once on app startup.
 * Installs window.__aster, then activates onStartup plugins.
 */
export async function initPluginLoader(
  plugins: LoadablePlugin[],
  resolvePluginUrl: (pluginId: string, path: string) => string,
): Promise<void> {
  asterApi = createPluginApi();
  activated = new Set<string>();
  (window as unknown as Record<string, unknown>)['__aster'] = asterApi;

  for (const plugin of plugins.filter((p) => p.activation.includes('onStartup'))) {
    activated.add(plugin.id);
    if (plugin.frontend) {
      await asterApi._activateModule(resolvePluginUrl(plugin.id, plugin.frontend), plugin.id);
    }
  }
}

/**
 * Activate plugins for a given trigger (e.g. 'onCodeBlock:mermaid').
 * Idempotent — already-loaded plugins are skipped.
 */
export async function activateForTrigger(
  trigger: string,
  plugins: LoadablePlugin[],
  resolvePluginUrl: (pluginId: string, path: string) => string,
): Promise<void> {
  if (!asterApi) return;
  for (const plugin of plugins.filter((p) => p.activation.includes(trigger) && !activated.has(p.id))) {
    activated.add(plugin.id);
    if (plugin.frontend) {
      await asterApi._activateModule(resolvePluginUrl(plugin.id, plugin.frontend), plugin.id);
    }
  }
}

export function getCodeBlockRenderer(lang: string) {
  return asterApi?.renderers.get(lang) ?? null;
}
