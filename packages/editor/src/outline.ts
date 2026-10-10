import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';

export interface OutlineItem {
  level: number;
  /** Heading text with inline markup stripped. */
  text: string;
  /** Document offset of the heading line start. */
  from: number;
}

const strip = (s: string) =>
  s.replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|~~|[*_]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();

/** Headings of level <= maxLevel, from the markdown syntax tree (code blocks are ignored). */
export function outline(state: EditorState, maxLevel = 3): OutlineItem[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  const out: OutlineItem[] = [];
  tree.iterate({
    enter(n) {
      let level = 0;
      if (n.name.startsWith('ATXHeading')) level = Number(n.name.slice(10));
      else if (n.name === 'SetextHeading1') level = 1;
      else if (n.name === 'SetextHeading2') level = 2;
      if (!level) return;
      if (level <= maxLevel) {
        const line = state.doc.lineAt(n.from);
        const raw = n.name.startsWith('ATX')
          ? line.text.replace(/^\s*#{1,6}\s*/, '').replace(/\s+#+\s*$/, '')
          : line.text;
        const text = strip(raw);
        if (text) out.push({ level, text, from: line.from });
      }
      return false;
    },
  });
  return out;
}

/** Document range currently visible in the scroller (not CodeMirror's render buffer). */
export function visibleRange(view: EditorView): { from: number; to: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  const top = view.lineBlockAtHeight(Math.max(0, rect.top - view.documentTop));
  const bottom = view.lineBlockAtHeight(Math.max(0, rect.bottom - view.documentTop - 1));
  return { from: top.from, to: bottom.to };
}

/** Scroll so `pos` sits near the top and put the cursor there. */
export function revealPos(view: EditorView, pos: number): void {
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }),
  });
  view.focus();
}
