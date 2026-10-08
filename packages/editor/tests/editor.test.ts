import { describe, it, expect } from 'vitest';
import { inputAssistExtension } from '../src/input-assist';
import { livePreviewExtension } from '../src/live-preview';

describe('input-assist', () => {
  it('exports a function', () => {
    expect(typeof inputAssistExtension).toBe('function');
  });
});

describe('live-preview', () => {
  it('exports a function', () => {
    expect(typeof livePreviewExtension).toBe('function');
  });
});
