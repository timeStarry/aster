import { EditorState, Extension, StateEffect } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { livePreviewExtension } from './live-preview';
import { sourceModeExtension } from './source-mode';
import { inputAssistExtension } from './input-assist';
import { typewriterScrollExtension } from './immersive';

export type EditorMode = 'live' | 'source' | 'reading';

export interface EditorOptions {
  initialContent?: string;
  mode?: EditorMode;
  onContentChange?: (content: string) => void;
}

export interface AsterEditor {
  view: EditorView;
  setMode(mode: EditorMode): void;
  getContent(): string;
  setContent(s: string): void;
  destroy(): void;
}

const reconfigure = StateEffect.define<Extension>();

function makeExtensions(mode: EditorMode): Extension[] {
  const base: Extension[] = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    inputAssistExtension(),
    typewriterScrollExtension(),
    EditorView.lineWrapping,
  ];
  if (mode === 'live') return [...base, livePreviewExtension()];
  if (mode === 'source') return [...base, sourceModeExtension()];
  return base; // 'reading' — rendered separately in ReadingView
}

export function createEditor(container: HTMLElement, opts: EditorOptions = {}): AsterEditor {
  const mode: { current: EditorMode } = { current: opts.mode ?? 'live' };

  const onUpdate = opts.onContentChange
    ? EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onContentChange!(u.state.doc.toString());
      })
    : [];

  const view = new EditorView({
    state: EditorState.create({
      doc: opts.initialContent ?? '',
      extensions: [
        makeExtensions(mode.current),
        onUpdate,
        EditorState.transactionExtender.of((tr) => {
          const reconfigureEffect = tr.effects.find((e) => e.is(reconfigure));
          if (!reconfigureEffect) return null;
          return { effects: [] };
        }),
      ],
    }),
    parent: container,
  });

  return {
    view,
    setMode(m: EditorMode) {
      mode.current = m;
      // Replace top-level extensions by replacing the whole state
      view.setState(
        EditorState.create({
          doc: view.state.doc,
          extensions: [makeExtensions(m), onUpdate],
        }),
      );
    },
    getContent: () => view.state.doc.toString(),
    setContent(s: string) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: s },
      });
    },
    destroy: () => view.destroy(),
  };
}

// Re-exports for UI layer
export { setImmersive } from './immersive';
export { formatTable } from './table-format';
