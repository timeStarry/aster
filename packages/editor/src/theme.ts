import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Editor chrome. All colors come from CSS variables defined by the app theme,
 * so light/dark switching needs no reconfiguration here.
 */
export const asterEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--fg)',
    backgroundColor: 'transparent',
    fontSize: 'var(--editor-font-size, 16px)',
  },
  // CodeMirror draws a dotted outline on the focused editor by default.
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-prose)',
    lineHeight: 'var(--editor-line-height, 1.75)',
    overflow: 'auto',
  },
  // The text column is centered. Its width is the line width plus fixed
  // padding, so text never touches the window edge on narrow windows.
  '.cm-content': {
    flex: '0 1 calc(var(--prose-width, 760px) + 64px)',
    maxWidth: 'calc(var(--prose-width, 760px) + 64px)',
    minWidth: '0',
    margin: '0 auto',
    padding: '40px 32px 40vh',
    caretColor: 'var(--accent)',
  },
  // With line numbers on, the gutter and the column are centered as one unit,
  // so numbers sit right before the start of each line instead of at the
  // window edge. The text width stays the same.
  '.cm-gutters + .cm-content': {
    marginInlineStart: '0',
    paddingInlineStart: '12px',
    flexBasis: 'calc(var(--prose-width, 760px) + 44px)',
    maxWidth: 'calc(var(--prose-width, 760px) + 44px)',
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': {
    marginInlineStart: 'auto',
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--fg-faint)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 0 0 8px',
    minWidth: '2.4em',
    fontSize: '0.8em',
    lineHeight: 'inherit',
  },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-search': { fontFamily: 'var(--font-ui)', fontSize: '13px', padding: '6px 10px' },
  '.cm-search input, .cm-search button': { fontFamily: 'inherit', fontSize: '12px' },
  '.cm-textfield': {
    border: '1px solid var(--border)',
    borderRadius: '4px',
    background: 'var(--bg)',
    color: 'var(--fg)',
    padding: '2px 6px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--fg)',
  },
  // Other occurrences of the selected text. CodeMirror's default is a
  // fluorescent #99ff7780 that ignores the theme.
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)', borderRadius: '2px' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--search-match)',
    boxShadow: 'inset 0 0 0 1px var(--search-outline)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--search-match-active)',
    boxShadow: 'inset 0 0 0 1px var(--accent)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'transparent',
    outline: '1px solid var(--fg-faint)',
  },
  '.cm-tooltip': {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
  },
});

/** Source-mode syntax colors: readable markup, not a rainbow. */
export const asterHighlight = HighlightStyle.define([
  // Source mode keeps a uniform line height so line numbers stay aligned.
  { tag: t.heading1, fontWeight: '700' },
  { tag: t.heading2, fontWeight: '700' },
  { tag: t.heading3, fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--code-fg)' },
  { tag: t.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--fg-faint)' },
  { tag: t.list, color: 'var(--fg-muted)' },
  // Fenced code contents (language-data highlighting)
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-number)' },
  { tag: [t.regexp, t.escape], color: 'var(--syn-string)' },
  { tag: [t.atom, t.self, t.constant(t.variableName), t.standard(t.variableName)], color: 'var(--syn-number)' },
  { tag: t.comment, color: 'var(--syn-comment, var(--fg-faint))' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--syn-fn)' },
  { tag: [t.typeName, t.className, t.namespace, t.attributeName], color: 'var(--syn-type)' },
  { tag: [t.tagName, t.special(t.variableName)], color: 'var(--syn-tag, var(--syn-keyword))' },
  { tag: [t.definition(t.propertyName), t.labelName], color: 'var(--syn-variable, var(--fg))' },
]);

export function themeExtension(): Extension {
  return [asterEditorTheme, syntaxHighlighting(asterHighlight)];
}
