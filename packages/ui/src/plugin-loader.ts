import { createPluginApi, type PluginApiImpl } from './plugin-api-impl';
import type { PluginManifest } from '@aster/plugin-api';

export let asterApi: PluginApiImpl | null = null;

/**
 * Initialize the plugin system. Call once on app startup.
 * Installs window.__aster, then activates onStartup plugins.
 */
export async function initPluginLoader(
  manifests: PluginManifest[],
  resolvePluginUrl: (pluginId: string, relativePath: string) => string,
): Promise<void> {
  asterApi = createPluginApi();
  // Expose globally so plugin ES modules can call window.__aster.*
  (window as Record<string, unknown>)['__aster'] = asterApi;

  // Activate onStartup plugins immediately
  const startupPlugins = manifests.filter(m => m.activation.includes('onStartup'));
  for (const plugin of startupPlugins) {
    if (plugin.frontend) {
      const url = resolvePluginUrl(plugin.id, plugin.frontend);
      await asterApi._activateModule(url, plugin.id);
    }
  }
}

/**
 * Activate plugins for a given trigger (e.g. 'onCodeBlock:mermaid').
 * Idempotent — already-loaded plugins are skipped.
 */
const activated = new Set<string>();
export async function activateForTrigger(
  trigger: string,
  manifests: PluginManifest[],
  resolvePluginUrl: (pluginId: string, relativePath: string) => string,
): Promise<void> {
  if (!asterApi) return;
  const matching = manifests.filter(m => m.activation.includes(trigger) && !activated.has(m.id));
  for (const plugin of matching) {
    activated.add(plugin.id);
    if (plugin.frontend) {
      const url = resolvePluginUrl(plugin.id, plugin.frontend);
      await asterApi._activateModule(url, plugin.id);
    }
  }
}

/** Get a renderer for the given code block language, triggering lazy load if needed. */
export function getCodeBlockRenderer(lang: string) {
  return asterApi?.renderers.get(lang) ?? null;
}
