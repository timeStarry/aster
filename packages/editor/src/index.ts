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
import { bracketMatching, indentOnInput, syntaxTree } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  livePreviewExtension,
  openBlockSourceEditor,
  closeBlockSourceEditor,
  refreshCodeBlocks,
  type CodeBlockRenderer,
} from './live-preview';
import { formattingExtension } from './formatting';
import { themeExtension } from './theme';
import {
  typewriterScrollExtension,
  cjkAutospaceExtension,
  focusModeExtension,
} from './immersive';
import { computeMinimalChange } from './diff';

/**
 * 3-state editor mode:
 * - `'live'`: Typora-style anti-jank Live Preview
 * - `'source'`: Raw Markdown source editing
 * - `'read'`: Distraction-free reading mode with frozen syntax (never expands raw markup on click/selection)
 */
export type EditorMode = 'live' | 'source' | 'read';

export interface EditorSettings {
  lineNumbers: boolean;
  typewriter: boolean;
  focusMode: boolean;
  cjkSpacing: boolean;
}

export interface EditorOptions {
  initialContent?: string;
  mode?: EditorMode;
  /** Forced read-only flag (e.g. non-UTF-8 lossy preview protection), independent of `mode`. */
  readOnly?: boolean;
  settings?: Partial<EditorSettings>;
  onContentChange?: (content: string) => void;
  onSelectionChange?: (state: EditorState) => void;
  /** Resolve markdown image paths (e.g. relative to the open file). */
  resolveImage?: (src: string) => string;
  /** Render fenced code blocks (math, diagrams) in live preview. */
  renderCodeBlock?: CodeBlockRenderer;
  /** Open external/relative/anchor links clicked in Read mode or ⌘/Ctrl+Clicked in Live mode. */
  onOpenLink?: (href: string) => void;
  /** Handle clipboard image paste (`⌘V`) for zero-interruption asset hosting. */
  onPasteImage?: (file: File, view: EditorView) => void | Promise<void>;
  /** Translations for CodeMirror UI strings (search panel etc.). */
  phrases?: Record<string, string>;
}

export interface AsterEditor {
  view: EditorView;
  getMode(): EditorMode;
  setMode(mode: EditorMode): void;
  setReadOnly(on: boolean): void;
  setSettings(s: Partial<EditorSettings>): void;
  /** Swap CodeMirror UI translations (e.g. after a language change). */
  setPhrases(p: Record<string, string>): void;
  getContent(): string;
  /** Replace the document (adds an undoable change). */
  setContent(s: string): void;
  /** Apply an external disk/agent edit via minimal diff as one undoable transaction, preserving cursor & scroll. */
  applyExternalContent(s: string): boolean;
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
const cjkComp = new Compartment();
const focusComp = new Compartment();
const phrasesComp = new Compartment();

let resolveImage: ((src: string) => string) | undefined;
let renderCodeBlock: CodeBlockRenderer | undefined;
let onOpenLink: ((href: string) => void) | undefined;

function modeExtension(mode: EditorMode): Extension {
  const modeClass =
    mode === 'read'
      ? 'cm-aster-prose cm-aster-read'
      : mode === 'live'
        ? 'cm-aster-prose cm-aster-live'
        : 'cm-aster-source';

  const attrs = EditorView.editorAttributes.of({ class: modeClass });
  if (mode === 'source') return attrs;
  return [
    attrs,
    livePreviewExtension({
      resolveImage,
      renderCodeBlock,
      freezeMarkup: mode === 'read',
      onOpenLink,
    }),
  ];
}

function readOnlyExtension(on: boolean): Extension {
  return [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
}

export function createEditor(container: HTMLElement, opts: EditorOptions = {}): AsterEditor {
  let mode: EditorMode = opts.mode ?? 'live';
  let forcedReadOnly = opts.readOnly ?? false;
  const settings: EditorSettings = {
    lineNumbers: false,
    typewriter: false,
    focusMode: false,
    cjkSpacing: true,
    ...opts.settings,
  };
  let phrases = opts.phrases ?? {};
  resolveImage = opts.resolveImage;
  renderCodeBlock = opts.renderCodeBlock;
  onOpenLink = opts.onOpenLink;

  const isLocked = () => forcedReadOnly || mode === 'read';
  const cjkExt = () => (settings.cjkSpacing && mode !== 'source' ? cjkAutospaceExtension() : []);
  const focusExt = () => (settings.focusMode && mode === 'live' ? focusModeExtension() : []);

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged) opts.onContentChange?.(u.state.doc.toString());
    if (u.selectionSet || u.docChanged) opts.onSelectionChange?.(u.state);
  });

  const pasteHandler = EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly) return false;
      const dt = event.clipboardData;
      if (!dt) return false;

      // 1. Clipboard image paste -> zero-interruption asset hosting
      if (opts.onPasteImage) {
        let imgFile: File | null = null;
        for (let i = 0; i < dt.files.length; i++) {
          if (dt.files[i].type.startsWith('image/')) {
            imgFile = dt.files[i];
            break;
          }
        }
        if (!imgFile && dt.items) {
          for (let i = 0; i < dt.items.length; i++) {
            const item = dt.items[i];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              imgFile = item.getAsFile();
              if (imgFile) break;
            }
          }
        }
        if (imgFile) {
          event.preventDefault();
          void opts.onPasteImage(imgFile, view);
          return true;
        }
      }

      // 2. Smart URL paste over non-empty single-line text selection -> `[selected](url)`
      const text = dt.getData('text/plain')?.trim() ?? '';
      if (/^https?:\/\/\S+$/i.test(text)) {
        const sel = view.state.selection.main;
        if (
          !sel.empty &&
          view.state.selection.ranges.length === 1 &&
          !isInsideCodeOrTableBlock(view.state, sel.from)
        ) {
          const selected = view.state.sliceDoc(sel.from, sel.to);
          if (
            !selected.includes('\n') &&
            selected.trim().length > 0 &&
            !/^https?:\/\//i.test(selected.trim()) &&
            !/^\[.*\]\(.*\)$/.test(selected.trim())
          ) {
            event.preventDefault();
            const wrapped = `[${selected}](${text})`;
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: wrapped },
              selection: { anchor: sel.from + wrapped.length },
              userEvent: 'input.paste',
            });
            return true;
          }
        }
      }

      return false;
    },
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
    search({
      top: true,
      createPanel: () => {
        const dom = document.createElement('span');
        dom.style.display = 'none';
        return { dom };
      },
    }),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
    formattingExtension(),
    keymap.of([
      ...closeBracketsKeymap,
      ...searchKeymap.filter((b) => b.key !== 'Mod-f' && b.key !== 'Escape'),
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    themeExtension(),
    modeComp.of(modeExtension(mode)),
    readOnlyComp.of(readOnlyExtension(isLocked())),
    lineNumbersComp.of(settings.lineNumbers ? lineNumbers() : []),
    typewriterComp.of(settings.typewriter ? typewriterScrollExtension() : []),
    cjkComp.of(cjkExt()),
    focusComp.of(focusExt()),
    phrasesComp.of(EditorState.phrases.of(phrases)),
    pasteHandler,
    listener,
  ];

  const createState = (doc: string) => EditorState.create({ doc, extensions: extensions() });

  const view = new EditorView({ state: createState(opts.initialContent ?? ''), parent: container });

  return {
    view,
    getMode: () => mode,
    setMode(m) {
      mode = m;
      view.dispatch({
        effects: [
          modeComp.reconfigure(modeExtension(m)),
          readOnlyComp.reconfigure(readOnlyExtension(isLocked())),
          cjkComp.reconfigure(cjkExt()),
          focusComp.reconfigure(focusExt()),
        ],
      });
    },
    setReadOnly(on) {
      forcedReadOnly = on;
      view.dispatch({ effects: readOnlyComp.reconfigure(readOnlyExtension(isLocked())) });
    },
    setSettings(s) {
      Object.assign(settings, s);
      view.dispatch({
        effects: [
          lineNumbersComp.reconfigure(settings.lineNumbers ? lineNumbers() : []),
          typewriterComp.reconfigure(settings.typewriter ? typewriterScrollExtension() : []),
          cjkComp.reconfigure(cjkExt()),
          focusComp.reconfigure(focusExt()),
        ],
      });
    },
    setPhrases(p) {
      phrases = p;
      view.dispatch({ effects: phrasesComp.reconfigure(EditorState.phrases.of(p)) });
    },
    getContent: () => view.state.doc.toString(),
    setContent(s) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } });
    },
    applyExternalContent(s) {
      const change = computeMinimalChange(view.state.doc.toString(), s);
      if (!change) return false;
      view.dispatch({ changes: change, userEvent: 'input.external' });
      return true;
    },
    setState(state) {
      view.setState(state);
      // A stored state may carry stale compartment values; re-apply current ones.
      view.dispatch({
        effects: [
          modeComp.reconfigure(modeExtension(mode)),
          readOnlyComp.reconfigure(readOnlyExtension(isLocked())),
          lineNumbersComp.reconfigure(settings.lineNumbers ? lineNumbers() : []),
          typewriterComp.reconfigure(settings.typewriter ? typewriterScrollExtension() : []),
          cjkComp.reconfigure(cjkExt()),
          focusComp.reconfigure(focusExt()),
          phrasesComp.reconfigure(EditorState.phrases.of(phrases)),
        ],
      });
    },
    createState,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

export {
  toggleInline,
  insertLink,
  setHeading,
  toggleLinePrefix,
  insertCodeBlock,
  insertMathBlock,
  insertCallout,
  insertTable,
} from './formatting';
export {
  formatTable, insertTableCmd, tableCommand, tableContext, findTable,
  type TableOp, type TableContext,
} from './tables';
export { openSearchPanel } from '@codemirror/search';
export {
  applyEditorSearch,
  clearEditorSearch,
  countEditorMatches,
  findNextMatch,
  findPrevMatch,
  replaceCurrentMatch,
  replaceAllMatches,
  type SearchSpec,
  type SearchStats,
} from './search-ctrl';
export {
  refreshCodeBlocks,
  openBlockSourceEditor,
  closeBlockSourceEditor,
  type CodeBlockRenderer,
} from './live-preview';
export { outline, visibleRange, revealPos, type OutlineItem } from './outline';
export { computeMinimalChange, type MinimalChange } from './diff';
export {
  cjkAutospaceExtension,
  focusModeExtension,
  __computeCjkDecorations,
  __computeFocusDecorations,
} from './immersive';

/** Return true if `pos` sits inside a fenced/indented code block, inline code, or GFM table. */
export function isInsideCodeOrTableBlock(state: EditorState, pos = state.selection.main.head): boolean {
  let inside = false;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter(ref) {
      if (
        ref.name === 'FencedCode' ||
        ref.name === 'CodeBlock' ||
        ref.name === 'InlineCode' ||
        ref.name === 'Table'
      ) {
        inside = true;
        return false;
      }
      return true;
    },
  });
  return inside;
}
