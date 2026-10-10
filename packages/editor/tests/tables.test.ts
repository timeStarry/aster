import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  displayWidth, findTable, cellAt, tableCommand, insertTableCmd, nextCell, formatTable,
} from '../src/tables';

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.destroy()); });

function makeView(doc: string, pos: number) {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.single(pos), extensions: [markdown({ base: markdownLanguage })] }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

describe('displayWidth', () => {
  it('counts CJK as two columns so tables line up', () => {
    expect(displayWidth('ab')).toBe(2);
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('a中')).toBe(3);
  });
});

describe('tables', () => {
  it('inserts a sized table and lands in the first header cell', () => {
    const view = makeView('', 0);
    insertTableCmd(2, 1)(view);
    const t = findTable(view.state, 0)!;
    expect(t.header).toEqual(['', '']);
    expect(t.body).toHaveLength(1);
    expect(cellAt(view.state, t, view.state.selection.main.head)).toEqual({ row: 0, col: 0 });
  });

  it('formats a CJK table so the delimiter matches display width', () => {
    const doc = '| a | 中文 |\n| - | - |\n| x | y |';
    const view = makeView(doc, 2);
    formatTable(view);
    const lines = view.state.doc.toString().split('\n');
    expect(lines[1].replace(/\s/g, '')).toMatch(/\|-+\|-+\|/);
    expect(displayWidth(lines[0].split('|')[2].trim())).toBe(4);
  });

  it('inserts a row below and a column to the right', () => {
    const view = makeView('| A | B |\n| - | - |\n| 1 | 2 |', 2);
    tableCommand('rowBelow')(view);
    expect(findTable(view.state, 0)!.body).toHaveLength(2);
    tableCommand('colRight')(view);
    const t = findTable(view.state, 0)!;
    expect(t.header).toHaveLength(3);
    expect(t.body[0]).toHaveLength(3);
  });

  it('Tab moves to the next cell and adds a row at the end', () => {
    const view = makeView('| A | B |\n| - | - |\n| 1 | 2 |', 2); // in A
    nextCell(view);
    let t = findTable(view.state, 0)!;
    expect(cellAt(view.state, t, view.state.selection.main.head)).toEqual({ row: 0, col: 1 });
    nextCell(view); // into 1
    nextCell(view); // into 2
    nextCell(view); // past last cell → new row
    t = findTable(view.state, 0)!;
    expect(t.body).toHaveLength(2);
    expect(cellAt(view.state, t, view.state.selection.main.head)).toEqual({ row: 2, col: 0 });
  });

  it('does not treat a lone pipe line as a table', () => {
    const view = makeView('not | a table', 0);
    expect(findTable(view.state, 0)).toBeNull();
    expect(tableCommand('format')(view)).toBe(false);
  });
});
