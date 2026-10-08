import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';

/** Toggle immersive (focus) mode by adding/removing a CSS class. */
export function setImmersive(view: EditorView, on: boolean): void {
  view.dom.classList.toggle('aster-immersive', on);
}

/**
 * Typewriter scroll: after each selection change, scroll the current line
 * to the vertical midpoint of the editor.
 */
export function typewriterScrollExtension(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return;
    const { view } = update;
    if (!view.dom.classList.contains('aster-typewriter')) return;
    const pos = view.state.selection.main.head;
    view.requestMeasure({
      read: () => {
        const coords = view.coordsAtPos(pos);
        const rect = view.dom.getBoundingClientRect();
        return coords ? coords.top - rect.top : null;
      },
      write: (lineOffset) => {
        if (lineOffset === null) return;
        const viewHeight = view.dom.getBoundingClientRect().height;
        view.scrollDOM.scrollTop += lineOffset - viewHeight / 2;
      },
    });
  });
}
