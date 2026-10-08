import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/manifest';

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const m = validateManifest({
      id: 'aster.mermaid',
      name: 'Mermaid',
      version: '1.0.0',
      apiVersion: '1',
      description: 'Render mermaid diagrams',
      permissions: [],
      activation: ['onCodeBlock:mermaid'],
      contributes: {},
    });
    expect(m.id).toBe('aster.mermaid');
  });

  it('throws on missing required fields', () => {
    expect(() => validateManifest({ id: 'aster.x' })).toThrow(/missing/i);
  });

  it('throws on invalid apiVersion', () => {
    expect(() => validateManifest({
      id: 'aster.x', name: 'X', version: '1.0.0',
      apiVersion: '99', description: 'd', permissions: [],
      activation: [], contributes: {},
    })).toThrow(/apiVersion/i);
  });
});
