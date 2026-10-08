import { Extension } from '@codemirror/state';
import {
  ViewPlugin, Decoration, DecorationSet, ViewUpdate, EditorView, WidgetType,
} from '@codemirror/view';

/**
 * Live-preview extension: headings are rendered as HTML elements when the
 * cursor is not on that line. M1 covers headings only; more syntax in M3.
 */
export function livePreviewExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  const widgets: ReturnType<typeof Decoration.replace>[] = [];

  for (let i = 1; i <= state.doc.lines; i++) {
    if (i === cursorLine) continue;
    const line = state.doc.line(i);
    const headingMatch = line.text.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      widgets.push(
        Decoration.replace({
          widget: new HeadingWidget(level, headingMatch[2]),
        }).range(line.from, line.to),
      );
    }
  }

  return Decoration.set(widgets, true);
}

class HeadingWidget extends WidgetType {
  constructor(private level: number, private text: string) { super(); }
  toDOM() {
    const el = document.createElement(`h${this.level}`);
    el.className = `aster-heading aster-h${this.level}`;
    el.textContent = this.text;
    return el;
  }
  eq(other: HeadingWidget) {
    return other.level === this.level && other.text === this.text;
  }
}
