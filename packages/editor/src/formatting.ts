import { EditorSelection, Extension, Prec } from '@codemirror/state';
import { EditorView, KeyBinding, keymap } from '@codemirror/view';
import { indentMore, indentLess } from '@codemirror/commands';
import { indentList, renumberChanges } from './lists';
import { nextCell, prevCell, insertTableCmd } from './tables';

type Cmd = (view: EditorView) => boolean;

/**
 * Toggle an inline wrapper (e.g. `**`) around each selection range.
 * - Selection already wrapped (inside or including the markers) → unwrap.
 * - Empty selection → insert a marker pair and place the cursor between them.
 */
export function toggleInline(marker: string): Cmd {
  return (view) => {
    if (view.state.readOnly) return false;
    const m = marker.length;
    const tr = view.state.changeByRange((range) => {
      const { from, to } = range;
      const doc = view.state.doc;
      const before = doc.sliceString(Math.max(0, from - m), from);
      const after = doc.sliceString(to, to + m);
      if (before === marker && after === marker) {
        return {
          changes: [{ from: from - m, to: from }, { from: to, to: to + m }],
          range: EditorSelection.range(from - m, to - m),
        };
      }
      const inner = doc.sliceString(from, to);
      if (inner.length >= 2 * m && inner.startsWith(marker) && inner.endsWith(marker)) {
        return {
          changes: { from, to, insert: inner.slice(m, inner.length - m) },
          range: EditorSelection.range(from, to - 2 * m),
        };
      }
      return {
        changes: [{ from, insert: marker }, { from: to, insert: marker }],
        range: EditorSelection.range(from + m, to + m),
      };
    });
    view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

/** Wrap the selection in a link: `[text](url)`, selecting the url placeholder. */
export const insertLink: Cmd = (view) => {
  if (view.state.readOnly) return false;
  const tr = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const isUrl = /^https?:\/\/\S+$/.test(text);
    if (isUrl) {
      const insert = `[](${text})`;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}](url)`;
    const urlFrom = range.from + text.length + 3;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(urlFrom, urlFrom + 3) };
  });
  view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

/** Distinct line numbers covered by the selection. */
function selectedLines(view: EditorView) {
  const seen = new Set<number>();
  const lines = [];
  for (const r of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(r.from).number;
    const last = view.state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(view.state.doc.line(n));
      }
    }
  }
  return lines;
}

const HEADING_RE = /^(#{1,6})\s+/;
const BLOCK_PREFIX_RE = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;

/** Set heading level (0 = paragraph). Applying the same level again clears it. */
export function setHeading(level: number): Cmd {
  return (view) => {
    if (view.state.readOnly) return false;
    const changes = selectedLines(view).map((line) => {
      const m = line.text.match(HEADING_RE);
      const current = m ? m[1].length : 0;
      const target = current === level ? 0 : level;
      const prefix = target > 0 ? '#'.repeat(target) + ' ' : '';
      return { from: line.from, to: line.from + (m ? m[0].length : 0), insert: prefix };
    });
    view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' });
    return true;
  };
}

type LinePrefixKind = 'bullet' | 'ordered' | 'task' | 'quote';

function prefixFor(kind: LinePrefixKind, index: number): string {
  switch (kind) {
    case 'bullet': return '- ';
    case 'ordered': return `${index + 1}. `;
    case 'task': return '- [ ] ';
    case 'quote': return '> ';
  }
}

function hasPrefix(kind: LinePrefixKind, text: string): RegExpMatchArray | null {
  switch (kind) {
    case 'bullet': return text.match(/^(\s*)([-*+]\s+)(?!\[[ xX]\])/);
    case 'ordered': return text.match(/^(\s*)(\d+[.)]\s+)/);
    case 'task': return text.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+)/);
    case 'quote': return text.match(/^(\s*)(>\s?)/);
  }
}

/**
 * Toggle a block prefix on every selected line. If all non-empty lines
 * already have it, remove it; otherwise apply it (replacing any other
 * block prefix such as a heading or a different list type).
 */
export function toggleLinePrefix(kind: LinePrefixKind): Cmd {
  return (view) => {
    if (view.state.readOnly) return false;
    const lines = selectedLines(view);
    const relevant = lines.filter((l) => l.text.trim() !== '' || lines.length === 1);
    const allHave = relevant.length > 0 && relevant.every((l) => hasPrefix(kind, l.text));
    let i = 0;
    const changes = relevant.map((line) => {
      if (allHave) {
        const m = hasPrefix(kind, line.text)!;
        return { from: line.from + m[1].length, to: line.from + m[0].length, insert: '' };
      }
      const other = line.text.match(BLOCK_PREFIX_RE);
      const indent = other ? other[1] : (line.text.match(/^\s*/)?.[0] ?? '');
      const removeTo = line.from + (other ? other[0].length : indent.length);
      return { from: line.from + indent.length, to: removeTo, insert: prefixFor(kind, i++) };
    });
    view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' });
    return true;
  };
}

/** Insert a fenced code block (wrapping the selection if any). */
export const insertCodeBlock: Cmd = (view) => {
  if (view.state.readOnly) return false;
  const tr = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const line = view.state.doc.lineAt(range.from);
    const lead = range.from === line.from ? '' : '\n';
    const insert = `${lead}\`\`\`\n${text}\n\`\`\`\n`;
    const cursor = range.from + lead.length + 3;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(cursor) };
  });
  view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

/** Insert a 3x2 table skeleton at the cursor. */
export const insertTable: Cmd = insertTableCmd(3, 2);
const LIST_RE = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)([.)])\s+|>\s?)/;

/**
 * Enter: continue lists / quotes / task lists. On an empty item, end the list
 * (remove the marker) instead of creating another empty item.
 */
export const continueMarkup: Cmd = (view) => {
  if (view.state.readOnly) return false;
  const { state } = view;
  if (state.selection.ranges.length > 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.from);
  const m = line.text.match(LIST_RE);
  if (!m) return false;
  if (range.from < line.from + m[0].length) return false;

  const content = line.text.slice(m[0].length);
  if (content.trim() === '' && range.from === line.to) {
    if (m[1].length > 0 && !m[2].startsWith('>')) return indentList(-1)(view);
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: EditorSelection.cursor(line.from),
      userEvent: 'input',
    });
    return true;
  }

  const indent = m[1];
  let marker = m[2];
  if (m[3]) marker = `${parseInt(m[3], 10) + 1}${m[4]} `;
  else if (/\[[ xX]\]/.test(marker)) marker = marker.replace(/\[[ xX]\]/, '[ ]');
  const insert = `\n${indent}${marker}`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  // Inserting in the middle of a numbered list shifts the items after it.
  if (m[3]) {
    const fix = renumberChanges(view.state, view.state.doc.lineAt(view.state.selection.main.head).number);
    if (fix.length) view.dispatch({ changes: fix, userEvent: 'input' });
  }
  return true;
};

/** Backspace right after an empty list marker removes the marker. */
export const deleteMarkup: Cmd = (view) => {
  if (view.state.readOnly) return false;
  const range = view.state.selection.main;
  if (!range.empty || view.state.selection.ranges.length > 1) return false;
  const line = view.state.doc.lineAt(range.from);
  const m = line.text.match(LIST_RE);
  if (!m || range.from !== line.from + m[0].length) return false;
  view.dispatch({
    changes: { from: line.from + m[1].length, to: range.from, insert: '' },
    userEvent: 'delete',
  });
  return true;
};

/** Tab inside a list item indents it; elsewhere inserts indentation. */
const tabIndent: Cmd = (view) => {
  if (view.state.readOnly) return false;
  if (indentList(1)(view)) return true;
  const r = view.state.selection.main;
  if (!r.empty) return indentMore(view);
  view.dispatch(view.state.replaceSelection('  '));
  return true;
};

const tabOutdent: Cmd = (view) => {
  if (view.state.readOnly) return false;
  return indentList(-1)(view) || indentLess(view);
};

export const formattingKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleInline('**'), preventDefault: true },
  { key: 'Mod-i', run: toggleInline('*'), preventDefault: true },
  { key: 'Mod-e', run: toggleInline('`'), preventDefault: true },
  { key: 'Mod-Shift-x', run: toggleInline('~~'), preventDefault: true },
  { key: 'Mod-k', run: insertLink, preventDefault: true },
  { key: 'Mod-Alt-c', run: insertCodeBlock, preventDefault: true },
  { key: 'Mod-Alt-t', run: insertTable, preventDefault: true },
  { key: 'Mod-0', run: setHeading(0), preventDefault: true },
  { key: 'Mod-1', run: setHeading(1), preventDefault: true },
  { key: 'Mod-2', run: setHeading(2), preventDefault: true },
  { key: 'Mod-3', run: setHeading(3), preventDefault: true },
  { key: 'Mod-4', run: setHeading(4), preventDefault: true },
  { key: 'Mod-5', run: setHeading(5), preventDefault: true },
  { key: 'Mod-6', run: setHeading(6), preventDefault: true },
  { key: 'Mod-Shift-8', run: toggleLinePrefix('bullet'), preventDefault: true },
  { key: 'Mod-Shift-7', run: toggleLinePrefix('ordered'), preventDefault: true },
  { key: 'Mod-Shift-9', run: toggleLinePrefix('task'), preventDefault: true },
  { key: 'Mod-Shift-.', run: toggleLinePrefix('quote'), preventDefault: true },
  { key: 'Enter', run: continueMarkup },
  { key: 'Backspace', run: deleteMarkup },
  { key: 'Tab', run: nextCell, shift: prevCell },
  { key: 'Tab', run: tabIndent, shift: tabOutdent },
];

export function formattingExtension(): Extension {
  // High precedence so Enter/Backspace/Tab win over the default keymap.
  return Prec.high(keymap.of(formattingKeymap));
}
