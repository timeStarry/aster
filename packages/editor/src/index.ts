import { Compartment, EditorState, Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { livePreviewExtension } from './live-preview';
import { formattingExtension } from './formatting';
import { themeExtension } from './theme';
import { typewriterScrollExtension } from './immersive';

/** Rendering mode. Read-only is an independent flag, not a mode. */
export type EditorMode = 'live' | 'source';

export interface EditorSettings {
  lineNumbers: boolean;
  typewriter: boolean;
}

export interface EditorOptions {
  initialContent?: string;
  mode?: EditorMode;
  readOnly?: boolean;
  settings?: Partial<EditorSettings>;
  onContentChange?: (content: string) => void;
  onSelectionChange?: (state: EditorState) => void;
  /** Resolve markdown image paths (e.g. relative to the open file). */
  resolveImage?: (src: string) => string;
}

export interface AsterEditor {
  view: EditorView;
  setMode(mode: EditorMode): void;
  setReadOnly(on: boolean): void;
  setSettings(s: Partial<EditorSettings>): void;
  getContent(): string;
  /** Replace the document (adds an undoable change). */
  setContent(s: string): void;
  /** Swap in a different document state (used for tab switching). */
  setState(state: EditorState): void;
  /** Build a fresh state for a new document using this editor's configuration. */
  createState(doc: string): EditorState;
  focus(): void;
  destroy(): void;
}

const modeComp = new Compartment();
const readOnlyComp = new Compartment();
const lineNumbersComp = new Compartment();
const typewriterComp = new Compartment();

let resolveImage: ((src: string) => string) | undefined;

function modeExtension(mode: EditorMode): Extension {
  return mode === 'live' ? livePreviewExtension({ resolveImage }) : [];
}

function readOnlyExtension(on: boolean): Extension {
  return [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
}

export function createEditor(container: HTMLElement, opts: EditorOptions = {}): AsterEditor {
  let mode: EditorMode = opts.mode ?? 'live';
  let readOnly = opts.readOnly ?? false;
  const settings: EditorSettings = { lineNumbers: false, typewriter: false, ...opts.settings };
  resolveImage = opts.resolveImage;

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged) opts.onContentChange?.(u.state.doc.toString());
    if (u.selectionSet || u.docChanged) opts.onSelectionChange?.(u.state);
  });

  const extensions = (): Extension[] => [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
    formattingExtension(),
    keymap.of([...closeBracketsKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
    themeExtension(),
    modeComp.of(modeExtension(mode)),
    readOnlyComp.of(readOnlyExtension(readOnly)),
    lineNumbersComp.of(settings.lineNumbers ? lineNumbers() : []),
    typewriterComp.of(settings.typewriter ? typewriterScrollExtension() : []),
    listener,
  ];

  const createState = (doc: string) => EditorState.create({ doc, extensions: extensions() });

  const view = new EditorView({ state: createState(opts.initialContent ?? ''), parent: container });

  return {
    view,
    setMode(m) {
      mode = m;
      view.dispatch({ effects: modeComp.reconfigure(modeExtension(m)) });
    },
    setReadOnly(on) {
      readOnly = on;
      view.dispatch({ effects: readOnlyComp.reconfigure(readOnlyExtension(on)) });
    },
    setSettings(s) {
      Object.assign(settings, s);
      view.dispatch({
        effects: [
          lineNumbersComp.reconfigure(settings.lineNumbers ? lineNumbers() : []),
          typewriterComp.reconfigure(settings.typewriter ? typewriterScrollExtension() : []),
        ],
      });
    },
    getContent: () => view.state.doc.toString(),
    setContent(s) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } });
    },
    setState(state) {
      view.setState(state);
      // A stored state may carry stale compartment values; re-apply current ones.
      view.dispatch({
        effects: [
          modeComp.reconfigure(modeExtension(mode)),
          readOnlyComp.reconfigure(readOnlyExtension(readOnly)),
          lineNumbersComp.reconfigure(settings.lineNumbers ? lineNumbers() : []),
          typewriterComp.reconfigure(settings.typewriter ? typewriterScrollExtension() : []),
        ],
      });
    },
    createState,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

export { formatTable } from './table-format';
export {
  toggleInline,
  insertLink,
  setHeading,
  toggleLinePrefix,
  insertCodeBlock,
  insertTable,
} from './formatting';
export { openSearchPanel } from '@codemirror/search';
