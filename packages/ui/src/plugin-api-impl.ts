export type RendererFn = (source: string) => Promise<string>;
export type CommandFn = (params: Record<string, unknown>) => Promise<unknown>;

/** Read access to the active document, provided by the host app. */
export interface EditorAccess {
  getContent(): string;
  /** Active document rendered to HTML by the host's markdown pipeline. */
  getHtml(): string;
  getTitle(): string;
}

export interface PluginThemeDef {
  id: string;
  name: string;
  /** Absolute URL of the theme stylesheet. */
  cssFile: string;
  /** Localized display names, e.g. { zh: '午夜' }. */
  i18n?: Record<string, string>;
}

export interface PluginApiImpl {
  /** Set by the host once the editor exists; null before that. */
  editor: EditorAccess | null;
  renderers: {
    register(lang: string, fn: RendererFn): void;
    get(lang: string): RendererFn | null;
  };
  commands: {
    register(id: string, fn: CommandFn): void;
    call(id: string, params: Record<string, unknown>): Promise<unknown>;
  };
  themes: {
    register(theme: PluginThemeDef): void;
    list(): PluginThemeDef[];
  };
  /** Internal: load and activate an ES module URL in an isolated scope. */
  _activateModule(url: string, pluginId: string): Promise<void>;
}

export function createPluginApi(): PluginApiImpl {
  const renderers = new Map<string, RendererFn>();
  const commands = new Map<string, CommandFn>();
  const themes: PluginThemeDef[] = [];

  return {
    editor: null,
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
      register: (t) => {
        // Re-registering (e.g. plugin reload) replaces the earlier entry.
        const i = themes.findIndex((x) => x.id === t.id);
        if (i >= 0) themes[i] = t; else themes.push(t);
      },
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
