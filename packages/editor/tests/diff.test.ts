// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { undo } from '@codemirror/commands';
import { createEditor, computeMinimalChange } from '../src/index';

describe('computeMinimalChange', () => {
  it('returns null when documents are identical', () => {
    expect(computeMinimalChange('# Title\nBody\n', '# Title\nBody\n')).toBeNull();
  });

  it('computes minimal middle splice for targeted edits', () => {
    const oldText = '# Intro\n## TODO\nsome text\n';
    const newText = '# Intro\n## TODO\n- agent item\nsome text\n';
    const diff = computeMinimalChange(oldText, newText);
    expect(diff).toEqual({
      from: '# Intro\n## TODO\n'.length,
      to: '# Intro\n## TODO\n'.length,
      insert: '- agent item\n',
    });
  });

  it('never splits UTF-16 surrogate pairs across prefix or suffix boundaries', () => {
    // 🚀 is U+1F680 (0xD83D 0xDE80), 🛸 is U+1F6F8 (0xD83D 0xDEF8) — share high surrogate 0xD83D!
    const oldText = 'Launch 🚀 now';
    const newText = 'Launch 🛸 now';
    const diff = computeMinimalChange(oldText, newText)!;
    expect(diff.from).toBe('Launch '.length);
    expect(diff.to).toBe('Launch 🚀'.length);
    expect(diff.insert).toBe('🛸');
  });

  it('applies external content as a single undoable transaction while preserving cursor', () => {
    const host = document.createElement('div');
    const ed = createEditor(host, {
      initialContent: '# Doc\n\nParagraph one.\n\nParagraph two.\n',
    });
    // Place cursor inside "Paragraph two."
    const cursorBefore = ed.getContent().indexOf('two');
    ed.view.dispatch({ selection: { anchor: cursorBefore } });

    const applied = ed.applyExternalContent('# Doc\n\nParagraph one (updated).\n\nParagraph two.\n');
    expect(applied).toBe(true);
    expect(ed.getContent()).toBe('# Doc\n\nParagraph one (updated).\n\nParagraph two.\n');

    // Cursor stays anchored on "two" instead of resetting to 0
    const cursorAfter = ed.view.state.selection.main.head;
    expect(ed.getContent().slice(cursorAfter, cursorAfter + 3)).toBe('two');

    // Single undo reverts the external sync cleanly
    undo(ed.view);
    expect(ed.getContent()).toBe('# Doc\n\nParagraph one.\n\nParagraph two.\n');
    ed.destroy();
  });
});
