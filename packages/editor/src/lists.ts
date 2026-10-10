import { EditorState, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * List structure helpers: indenting items under their previous sibling and
 * renumbering ordered lists so each nesting level counts on its own
 * (1. 2. → nested a sublist restarts at 1, the parent keeps counting).
 */

const ITEM_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))(?=[ \t]|$)[ \t]*/;

export interface ListItem {
  indent: number;
  ordered: boolean;
  num: number;
  /** Offsets of the number within the line (ordered items only). */
  numFrom: number;
  numTo: number;
  /** Column where the item's content starts: where children must be indented. */
  contentCol: number;
}

export function parseListItem(text: string): ListItem | null {
  const m = ITEM_RE.exec(text);
  if (!m) return null;
  const indent = m[1].length;
  if (m[3] !== undefined) {
    const numTo = indent + m[3].length;
    // "1." with nothing after still nests children past the delimiter + 1 space.
    return { indent, ordered: true, num: Number(m[3]), numFrom: indent, numTo, contentCol: Math.max(m[0].length, numTo + 2) };
  }
  return { indent, ordered: false, num: 0, numFrom: indent, numTo: indent, contentCol: Math.max(m[0].length, indent + 2) };
}

const leading = (s: string) => s.length - s.trimStart().length;

/**
 * Renumber ordered items: siblings count up from the first item of their list;
 * a nested list starts at 1. Bullets are left alone.
 */
export function renumber(lines: string[]): string[] {
  const stack: { indent: number; ordered: boolean; next: number }[] = [];
  return lines.map((text) => {
    const it = parseListItem(text);
    if (!it) return text;
    while (stack.length && stack[stack.length - 1].indent > it.indent) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.indent < it.indent) {
      // The outermost list keeps its start number; nested lists restart at 1.
      top = { indent: it.indent, ordered: it.ordered, next: stack.length === 0 ? it.num || 1 : 1 };
      stack.push(top);
    } else if (top.ordered !== it.ordered) {
      // Switching between bullets and numbers starts a new list.
      top.ordered = it.ordered;
      top.next = 1;
    }
    if (!it.ordered) return text;
    const n = top.next++;
    return text.slice(0, it.numFrom) + n + text.slice(it.numTo);
  });
}

/** Contiguous run of list lines (items and their indented continuations) around `lineNo`. */
function listBlock(state: EditorState, lineNo: number): { first: number; last: number } | null {
  const doc = state.doc;
  const inBlock = (n: number) => {
    const text = doc.line(n).text;
    return text.trim() !== '' && (parseListItem(text) !== null || /^[ \t]/.test(text));
  };
  if (!inBlock(lineNo)) return null;
  let first = lineNo;
  let last = lineNo;
  while (first > 1 && inBlock(first - 1)) first--;
  while (last < doc.lines && inBlock(last + 1)) last++;
  return { first, last };
}

/** Minimal per-line change from `oldText` to `newText` (keeps cursors stable). */
function lineDiff(from: number, oldText: string, newText: string): ChangeSpec | null {
  if (oldText === newText) return null;
  let a = 0;
  while (a < oldText.length && a < newText.length && oldText[a] === newText[a]) a++;
  let b = 0;
  while (b < oldText.length - a && b < newText.length - a && oldText[oldText.length - 1 - b] === newText[newText.length - 1 - b]) b++;
  return { from: from + a, to: from + oldText.length - b, insert: newText.slice(a, newText.length - b) };
}

/** Changes that renumber the list block containing `lineNo`, in `state`'s coordinates. */
export function renumberChanges(state: EditorState, lineNo: number): ChangeSpec[] {
  const block = listBlock(state, lineNo);
  if (!block) return [];
  const lines: string[] = [];
  for (let n = block.first; n <= block.last; n++) lines.push(state.doc.line(n).text);
  const next = renumber(lines);
  const out: ChangeSpec[] = [];
  next.forEach((text, i) => {
    const c = lineDiff(state.doc.line(block.first + i).from, lines[i], text);
    if (c) out.push(c);
  });
  return out;
}

/**
 * Tab / Shift-Tab on list items. Indent nests an item under its previous
 * sibling (at that sibling's content column, as CommonMark requires); outdent
 * moves it to its parent's level. Children move with their item, and ordered
 * lists are renumbered. Returns false when the selection has no list items so
 * the caller can fall back to plain indentation.
 */
export function indentList(dir: 1 | -1) {
  return (view: EditorView): boolean => {
    const { state } = view;
    if (state.readOnly) return false;
    const doc = state.doc;

    const selected = new Set<number>();
    for (const r of state.selection.ranges) {
      for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) {
        if (parseListItem(doc.line(n).text)) selected.add(n);
      }
    }
    if (selected.size === 0) return false;

    // Group selected items by list block; edit each block independently.
    const blocks = new Map<number, { first: number; last: number }>();
    for (const n of selected) {
      const b = listBlock(state, n);
      if (b) blocks.set(b.first, b);
    }

    const changes: ChangeSpec[] = [];
    for (const { first, last } of blocks.values()) {
      const orig: string[] = [];
      for (let n = first; n <= last; n++) orig.push(doc.line(n).text);
      const cur = [...orig];
      const handled = new Set<number>();

      for (let k = 0; k < cur.length; k++) {
        if (!selected.has(first + k) || handled.has(k)) continue;
        const it = parseListItem(cur[k])!;
        let target: number | null = null;
        for (let j = k - 1; j >= 0; j--) {
          const p = parseListItem(cur[j]);
          if (!p) continue;
          if (dir === 1) {
            if (p.indent === it.indent) { target = p.contentCol; break; }
            if (p.indent < it.indent) break; // first child: nothing to nest under
          } else if (p.indent < it.indent) {
            target = p.indent;
            break;
          }
        }
        if (dir === -1 && target === null) target = 0;
        if (target === null || target === it.indent) continue;
        const delta = target - it.indent;

        // The item and its subtree (following lines indented deeper than it).
        let end = k + 1;
        while (end < cur.length && leading(cur[end]) > it.indent) end++;
        for (let j = k; j < end; j++) {
          cur[j] = delta > 0
            ? ' '.repeat(delta) + cur[j]
            : cur[j].slice(Math.min(-delta, leading(cur[j])));
          handled.add(j);
        }
      }

      const next = renumber(cur);
      next.forEach((text, i) => {
        const c = lineDiff(doc.line(first + i).from, orig[i], text);
        if (c) changes.push(c);
      });
    }

    // Consume Tab inside lists even when nothing moved (e.g. the first item),
    // so focus doesn't leave the editor.
    if (changes.length) {
      view.dispatch({ changes, scrollIntoView: true, userEvent: dir === 1 ? 'input.indent' : 'delete.dedent' });
    }
    return true;
  };
}
