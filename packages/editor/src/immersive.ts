import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';

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
