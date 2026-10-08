export type RendererFn = (source: string) => Promise<string>;
export type CommandFn = (params: Record<string, unknown>) => Promise<unknown>;

export interface PluginApiImpl {
  renderers: {
    register(lang: string, fn: RendererFn): void;
    get(lang: string): RendererFn | null;
  };
  commands: {
    register(id: string, fn: CommandFn): void;
    call(id: string, params: Record<string, unknown>): Promise<unknown>;
  };
  themes: {
    register(theme: { id: string; name: string; cssFile: string }): void;
    list(): Array<{ id: string; name: string; cssFile: string }>;
  };
  /** Internal: load and activate an ES module URL in an isolated scope. */
  _activateModule(url: string, pluginId: string): Promise<void>;
}

export function createPluginApi(): PluginApiImpl {
  const renderers = new Map<string, RendererFn>();
  const commands = new Map<string, CommandFn>();
  const themes: Array<{ id: string; name: string; cssFile: string }> = [];

  return {
    renderers: {
      register: (lang, fn) => renderers.set(lang, fn),
      get: (lang) => renderers.get(lang) ?? null,
    },
    commands: {
      register: (id, fn) => commands.set(id, fn),
      async call(id, params) {
        const fn = commands.get(id);
        if (!fn) throw new Error(`plugin command not found: ${id}`);
        return fn(params);
      },
    },
    themes: {
      register: (t) => themes.push(t),
      list: () => [...themes],
    },
    async _activateModule(url: string, pluginId: string) {
      try {
        await import(/* @vite-ignore */ url);
      } catch (e) {
        console.error(`[aster-plugins] plugin ${pluginId} activation failed:`, e);
        // Isolation: failure does not propagate — other plugins unaffected.
      }
    },
  };
}
