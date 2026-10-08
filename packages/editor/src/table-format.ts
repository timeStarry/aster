import { EditorView } from '@codemirror/view';

/** Format the Markdown table that contains the current cursor position. */
export function formatTable(view: EditorView): boolean {
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.head);

  if (!isTableRow(cursorLine.text)) return false;

  // Expand to full table range
  let start = cursorLine.number;
  let end = cursorLine.number;
  while (start > 1 && isTableRow(state.doc.line(start - 1).text)) start--;
  while (end < state.doc.lines && isTableRow(state.doc.line(end + 1).text)) end++;

  const rows = Array.from({ length: end - start + 1 }, (_, i) =>
    state.doc.line(start + i).text,
  );
  const formatted = formatTableRows(rows);
  const from = state.doc.line(start).from;
  const to = state.doc.line(end).to;
  view.dispatch({ changes: { from, to, insert: formatted.join('\n') } });
  return true;
}

function isTableRow(text: string): boolean {
  return text.trim().startsWith('|');
}

function formatTableRows(rows: string[]): string[] {
  const parsed = rows.map((r) =>
    r.split('|').slice(1, -1).map((c) => c.trim()),
  );
  const cols = Math.max(...parsed.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, ci) =>
    Math.max(...parsed.map((r) => (r[ci] ?? '').length), 3),
  );
  return parsed.map((cells, ri) => {
    const padded = Array.from({ length: cols }, (_, ci) => {
      const cell = cells[ci] ?? '';
      // Separator row
      if (ri === 1 && /^[-:]+$/.test(cell.replace(/\s/g, ''))) {
        return '-'.repeat(widths[ci]);
      }
      return cell.padEnd(widths[ci]);
    });
    return `| ${padded.join(' | ')} |`;
  });
}
