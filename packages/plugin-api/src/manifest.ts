export interface CommandContrib {
  id: string;
  description: string;
  params: object;
  returns: object;
  headless: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Must be "1" for this API generation */
  apiVersion: '1';
  description: string;
  permissions: string[];
  activation: string[];
  frontend?: string;
  backend?: string | null;
  contributes: {
    commands?: CommandContrib[];
    renderers?: Array<{ codeBlock?: string }>;
    themes?: Array<{ id: string; name: string; cssFile: string }>;
    settings?: object;
  };
}

const REQUIRED = ['id','name','version','apiVersion','description','permissions','activation','contributes'] as const;

export function validateManifest(obj: unknown): PluginManifest {
  if (typeof obj !== 'object' || obj === null) throw new Error('manifest must be an object');
  const m = obj as Record<string, unknown>;
  for (const key of REQUIRED) {
    if (!(key in m)) throw new Error(`manifest missing required field: ${key}`);
  }
  if (m['apiVersion'] !== '1') throw new Error(`unsupported apiVersion "${m['apiVersion']}"; expected "1"`);
  if (typeof m['id'] !== 'string' || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(m['id'] as string)) {
    throw new Error(`manifest id "${m['id']}" must be reverse-domain style (e.g. "aster.mermaid")`);
  }
  return m as unknown as PluginManifest;
}

export { MANIFEST_SCHEMA } from './schema';
