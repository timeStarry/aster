import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * GFM table model: find the table around the cursor, edit it as rows and
 * cells, and write it back aligned. Alignment counts East Asian wide
 * characters as two columns so Chinese tables line up in monospace source.
 */

export type Align = 'left' | 'center' | 'right' | null;

export interface Table {
  /** Document offsets covering the whole table. */
  from: number;
  to: number;
  /** Line number of the header row. */
  firstLine: number;
  header: string[];
  align: Align[];
  body: string[][];
}

/** Model rows: 0 is the header, 1..n are body rows (the delimiter is not a row). */
export interface CellPos { row: number; col: number }

type Cmd = (view: EditorView) => boolean;

// ── Parsing ──────────────────────────────────────────────────

export function splitRow(text: string): string[] {
  let s = text.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const DELIM_CELL = /^:?-+:?$/;
const isRowLine = (text: string) => text.trim() !== '' && text.includes('|');
function isDelimiterRow(text: string): boolean {
  if (!text.includes('-')) return false;
  return splitRow(text).every((c) => DELIM_CELL.test(c));
}
function alignOf(cell: string): Align {
  const l = cell.startsWith(':');
  const r = cell.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
}

export function findTable(state: EditorState, pos: number): Table | null {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  if (!isRowLine(line.text)) return null;
  let first = line.number;
  let last = line.number;
  while (first > 1 && isRowLine(doc.line(first - 1).text)) first--;
  while (last < doc.lines && isRowLine(doc.line(last + 1).text)) last++;
  // A run of pipe lines is only a table when its second line is the delimiter.
  if (last - first < 1 || !isDelimiterRow(doc.line(first + 1).text)) return null;

  const header = splitRow(doc.line(first).text);
  const align = splitRow(doc.line(first + 1).text).map(alignOf);
  const body: string[][] = [];
  for (let n = first + 2; n <= last; n++) body.push(splitRow(doc.line(n).text));
  const cols = Math.max(header.length, align.length, ...body.map((r) => r.length));
  const pad = (r: string[]) => { while (r.length < cols) r.push(''); return r; };
  pad(header);
  while (align.length < cols) align.push(null);
  body.forEach(pad);
  return { from: doc.line(first).from, to: doc.line(last).to, firstLine: first, header, align: align.slice(0, cols), body };
}

/** Which cell the document position is in. The delimiter line maps to the header. */
export function cellAt(state: EditorState, table: Table, pos: number): CellPos {
  const line = state.doc.lineAt(pos);
  const li = line.number - table.firstLine;
  const row = li <= 1 ? 0 : li - 1;
  const text = line.text;
  const off = pos - line.from;
  let i = text.length - text.trimStart().length;
  if (text[i] === '|') i++;
  let col = 0;
  for (; i < off && i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '|') col++;
  }
  return { row, col: Math.min(col, table.header.length - 1) };
}

// ── Formatting ───────────────────────────────────────────────

function isWide(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd);
}

/** Monospace display width: wide (CJK, fullwidth, emoji) characters count as 2. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return w;
}

interface Model { header: string[]; align: Align[]; body: string[][] }

/** Lines of the aligned table plus, per line, the string offset where each cell's content starts. */
function render(m: Model): { lines: string[]; starts: number[][]; ends: number[][] } {
  const cols = m.header.length;
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(3, displayWidth(m.header[c]), ...m.body.map((r) => displayWidth(r[c] ?? ''))));
  const row = (cells: string[]) => {
    let s = '|';
    const st: number[] = [];
    const en: number[] = [];
    cells.forEach((cell, c) => {
      const gap = widths[c] - displayWidth(cell);
      const a = m.align[c];
      const left = a === 'right' ? gap : a === 'center' ? Math.floor(gap / 2) : 0;
      s += ' ' + ' '.repeat(left);
      st.push(s.length);
      s += cell;
      en.push(s.length);
      s += ' '.repeat(gap - left) + ' |';
    });
    return { s, st, en };
  };
  const delim = '|' + m.align.map((a, c) => {
    const w = widths[c];
    const d = '-'.repeat(Math.max(1, w - (a === 'center' ? 2 : a ? 1 : 0)));
    return ' ' + (a === 'center' ? `:${d}:` : a === 'right' ? `${d}:` : a === 'left' ? `:${d}` : d) + ' |';
  }).join('');
  const rows = [m.header, ...m.body].map(row);
  return {
    lines: [rows[0].s, delim, ...rows.slice(1).map((r) => r.s)],
    starts: rows.map((r) => r.st),
    ends: rows.map((r) => r.en),
  };
}

/** Replace `table` with model `m`; put the cursor in (or select) cell `at`. */
function write(view: EditorView, table: Table, m: Model, at: CellPos, selectCell = false) {
  const r = render(m);
  const row = Math.max(0, Math.min(at.row, m.body.length));
  const col = Math.max(0, Math.min(at.col, m.header.length - 1));
  // Line offset within the new text: header line 0, delimiter line 1, body row k on line k+1.
  const lineIdx = row === 0 ? 0 : row + 1;
  let base = table.from;
  for (let i = 0; i < lineIdx; i++) base += r.lines[i].length + 1;
  const s = base + r.starts[row][col];
  const e = base + r.ends[row][col];
  view.dispatch({
    changes: { from: table.from, to: table.to, insert: r.lines.join('\n') },
    selection: selectCell && e > s ? EditorSelection.range(s, e) : EditorSelection.cursor(e),
    scrollIntoView: true,
    userEvent: 'input.table',
  });
}

const clone = (t: Table): Model => ({ header: [...t.header], align: [...t.align], body: t.body.map((r) => [...r]) });

// ── Commands ─────────────────────────────────────────────────

export type TableOp =
  | 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight'
  | 'deleteRow' | 'deleteCol'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignNone'
  | 'format' | 'deleteTable';

export interface TableContext { row: number; col: number; rows: number; cols: number; align: Align }

/** Where the cursor is in a table, or null outside tables. */
export function tableContext(state: EditorState): TableContext | null {
  const head = state.selection.main.head;
  const t = findTable(state, head);
  if (!t) return null;
  const c = cellAt(state, t, head);
  return { ...c, rows: t.body.length, cols: t.header.length, align: t.align[c.col] };
}

export function tableCommand(op: TableOp): Cmd {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return false;
    const head = state.selection.main.head;
    const t = findTable(state, head);
    if (!t) return false;
    const at = cellAt(state, t, head);
    const m = clone(t);
    const blank = () => m.header.map(() => '');

    switch (op) {
      case 'rowAbove':
      case 'rowBelow': {
        // Rows can't go above the header; both insert the first body row there.
        const idx = at.row === 0 ? 0 : at.row - 1 + (op === 'rowBelow' ? 1 : 0);
        m.body.splice(idx, 0, blank());
        write(view, t, m, { row: idx + 1, col: at.col });
        return true;
      }
      case 'colLeft':
      case 'colRight': {
        const idx = at.col + (op === 'colRight' ? 1 : 0);
        m.header.splice(idx, 0, '');
        m.align.splice(idx, 0, null);
        m.body.forEach((r) => r.splice(idx, 0, ''));
        write(view, t, m, { row: at.row, col: idx });
        return true;
      }
      case 'deleteRow': {
        if (at.row === 0) return false;
        m.body.splice(at.row - 1, 1);
        write(view, t, m, { row: Math.min(at.row, m.body.length), col: at.col });
        return true;
      }
      case 'deleteCol': {
        if (m.header.length <= 1) return false;
        m.header.splice(at.col, 1);
        m.align.splice(at.col, 1);
        m.body.forEach((r) => r.splice(at.col, 1));
        write(view, t, m, { row: at.row, col: Math.min(at.col, m.header.length - 1) });
        return true;
      }
      case 'alignLeft': case 'alignCenter': case 'alignRight': case 'alignNone': {
        m.align[at.col] = op === 'alignLeft' ? 'left' : op === 'alignCenter' ? 'center' : op === 'alignRight' ? 'right' : null;
        write(view, t, m, at);
        return true;
      }
      case 'format':
        write(view, t, m, at);
        return true;
      case 'deleteTable': {
        const doc = state.doc;
        // Also swallow one following blank line so no gap is left behind.
        const endLine = doc.lineAt(t.to);
        const to = endLine.number < doc.lines && doc.line(endLine.number + 1).text.trim() === '' ? doc.line(endLine.number + 1).to : t.to;
        view.dispatch({ changes: { from: t.from, to, insert: '' }, selection: EditorSelection.cursor(t.from), userEvent: 'delete.table' });
        return true;
      }
    }
  };
}

/** Tab in a table: go to the next cell (selecting its text); past the last cell, add a row. */
export const nextCell: Cmd = (view) => {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length > 1) return false;
  const t = findTable(state, state.selection.main.head);
  if (!t) return false;
  const at = cellAt(state, t, state.selection.main.head);
  const m = clone(t);
  let next: CellPos;
  if (at.col + 1 < m.header.length) next = { row: at.row, col: at.col + 1 };
  else {
    next = { row: at.row + 1, col: 0 };
    if (next.row > m.body.length) m.body.push(m.header.map(() => ''));
  }
  write(view, t, m, next, true);
  return true;
};

/** Shift-Tab in a table: go to the previous cell. */
export const prevCell: Cmd = (view) => {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length > 1) return false;
  const t = findTable(state, state.selection.main.head);
  if (!t) return false;
  const at = cellAt(state, t, state.selection.main.head);
  const prev = at.col > 0 ? { row: at.row, col: at.col - 1 }
    : at.row > 0 ? { row: at.row - 1, col: t.header.length - 1 }
    : at;
  write(view, t, clone(t), prev, true);
  return true;
};

/** Align the table under the cursor (CJK-aware). */
export function formatTable(view: EditorView): boolean {
  return tableCommand('format')(view);
}

/** Insert an empty table with `cols` columns and `rows` body rows; the cursor lands in the first header cell. */
export function insertTableCmd(cols = 3, rows = 2): Cmd {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return false;
    const m: Model = {
      header: Array(cols).fill(''),
      align: Array(cols).fill(null),
      body: Array.from({ length: rows }, () => Array(cols).fill('')),
    };
    const r = render(m);
    const line = state.doc.lineAt(state.selection.main.head);
    const empty = line.text.trim() === '';
    const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
    const lead = empty ? '' : '\n\n';
    const trail = next && next.text.trim() !== '' ? '\n' : '';
    const from = empty ? line.from : line.to;
    const to = empty ? line.to : line.to;
    const text = lead + r.lines.join('\n') + trail;
    const cursor = from + lead.length + r.starts[0][0];
    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
      userEvent: 'input.table',
    });
    return true;
  };
}
