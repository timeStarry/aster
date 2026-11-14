import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, Extension, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

/** Typewriter scroll: keep the cursor line at the vertical middle of the editor. */
export function typewriterScrollExtension(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;
    const { view } = update;
    const pos = view.state.selection.main.head;
    view.requestMeasure({
      read: () => {
        const coords = view.coordsAtPos(pos);
        const rect = view.scrollDOM.getBoundingClientRect();
        return coords ? { offset: coords.top - rect.top, height: rect.height } : null;
      },
      write: (m) => {
        if (!m) return;
        view.scrollDOM.scrollTop += m.offset - m.height / 2;
      },
    });
  });
}

// ── Non-destructive CJK–Latin Visual Autospace ─────────────────────────────

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const LATIN_OR_DIGIT_RE = /[A-Za-z0-9]/;
const SKIP_AUTOSPACE_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'CodeMark',
  'URL',
  'Autolink',
  'LinkMark',
  'HeaderMark',
]);

const cjkGapMark = Decoration.mark({ class: 'aster-cjk-gap-after' });

export function __computeCjkDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  const tree = syntaxTree(state);
  const skipped: [number, number][] = [];
  for (const r of ranges) {
    tree.iterate({
      from: r.from,
      to: r.to,
      enter(node) {
        if (SKIP_AUTOSPACE_NODES.has(node.name)) {
          skipped.push([node.from, node.to]);
          return false;
        }
        return true;
      },
    });
  }

  let skipIdx = 0;
  const isSkipped = (pos: number): boolean => {
    while (skipIdx < skipped.length && skipped[skipIdx][1] <= pos) skipIdx++;
    return skipIdx < skipped.length && pos >= skipped[skipIdx][0] && pos < skipped[skipIdx][1];
  };

  const out: Range<Decoration>[] = [];
  for (const r of ranges) {
    const startLine = state.doc.lineAt(r.from).number;
    const endLine = state.doc.lineAt(r.to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      const line = state.doc.line(ln);
      const text = line.text;
      if (text.length < 2) continue;
      for (let i = 0; i < text.length - 1; i++) {
        const a = text[i];
        const b = text[i + 1];
        const boundary =
          (CJK_RE.test(a) && LATIN_OR_DIGIT_RE.test(b)) ||
          (LATIN_OR_DIGIT_RE.test(a) && CJK_RE.test(b));
        if (!boundary) continue;
        const absPos = line.from + i;
        if (isSkipped(absPos) || isSkipped(absPos + 1)) continue;
        out.push(cjkGapMark.range(absPos, absPos + 1));
      }
    }
  }
  return Decoration.set(out, true);
}

/**
 * Adds subtle visual breathing room (~0.12em) between adjacent CJK and ASCII
 * alphanumeric characters without mutating the underlying Markdown document.
 */
export function cjkAutospaceExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = __computeCjkDecorations(view.state, view.visibleRanges);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = __computeCjkDecorations(update.state, update.view.visibleRanges);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ── Paragraph Focus / Spotlight Mode ───────────────────────────────────────

const FOCUS_BLOCK_NODES = new Set([
  'Paragraph',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'FencedCode',
  'CodeBlock',
  'Table',
  'Blockquote',
  'HorizontalRule',
]);

const focusDimLine = Decoration.line({ class: 'aster-focus-dim' });

function activeBlockRange(state: EditorState): { from: number; to: number } {
  const head = state.selection.main.head;
  const tree = syntaxTree(state);
  let cur: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(head, 1);
  let found: { from: number; to: number } | null = null;
  while (cur) {
    if (FOCUS_BLOCK_NODES.has(cur.name)) {
      found = { from: cur.from, to: cur.to };
      // Prefer the innermost Paragraph/Heading inside lists, but keep Blockquote/Table whole.
      if (cur.name !== 'Paragraph' || cur.parent?.name !== 'Blockquote') break;
    }
    cur = cur.parent;
  }
  if (!found) {
    const line = state.doc.lineAt(head);
    return { from: line.from, to: line.to };
  }
  return {
    from: state.doc.lineAt(found.from).from,
    to: state.doc.lineAt(found.to).to,
  };
}

export function __computeFocusDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  const active = activeBlockRange(state);
  const out: Range<Decoration>[] = [];
  const seenLines = new Set<number>();
  for (const r of ranges) {
    const startLine = state.doc.lineAt(r.from).number;
    const endLine = state.doc.lineAt(r.to).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      if (seenLines.has(ln)) continue;
      seenLines.add(ln);
      const line = state.doc.line(ln);
      if (line.to < active.from || line.from > active.to) {
        out.push(focusDimLine.range(line.from));
      }
    }
  }
  return Decoration.set(out, true);
}

/** Dims non-active blocks so the paragraph or block at the cursor stands out. */
export function focusModeExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = __computeFocusDecorations(view.state, view.visibleRanges);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = __computeFocusDecorations(update.state, update.view.visibleRanges);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
