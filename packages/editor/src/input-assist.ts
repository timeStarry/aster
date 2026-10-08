import { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

/**
 * Input-assist extension: list continuation, indentation helpers,
 * bracket auto-pairing, URL wrapping on paste.
 */
export function inputAssistExtension(): Extension {
  return [
    keymap.of([
      {
        key: 'Enter',
        run: (view) => {
          const { state } = view;
          const { from } = state.selection.main;
          const line = state.doc.lineAt(from);

          // Unordered list continuation
          const ulMatch = line.text.match(/^(\s*)([-*+])\s+(.*)/);
          if (ulMatch) {
            const [, indent, marker, content] = ulMatch;
            if (content.trim() === '') {
              view.dispatch({ changes: { from: line.from, to: from, insert: '\n' } });
              return true;
            }
            view.dispatch({ changes: { from, insert: `\n${indent}${marker} ` } });
            return true;
          }

          // Ordered list continuation
          const olMatch = line.text.match(/^(\s*)(\d+)\.\s+(.*)/);
          if (olMatch) {
            const [, indent, num, content] = olMatch;
            if (content.trim() === '') {
              view.dispatch({ changes: { from: line.from, to: from, insert: '\n' } });
              return true;
            }
            const next = parseInt(num, 10) + 1;
            view.dispatch({ changes: { from, insert: `\n${indent}${next}. ` } });
            return true;
          }

          return false;
        },
      },
    ]),
  ];
}
