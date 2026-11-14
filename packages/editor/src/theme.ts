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
    paddingInline: '32px',
  },
  // The text column is centered with zero horizontal padding on .cm-content so
  // CodeMirror's drawSelection rectangles start flush at character column 0
  // instead of overhanging into left/right padding on multi-line selections.
  '.cm-content': {
    flex: '0 1 var(--prose-width, 760px)',
    maxWidth: 'var(--prose-width, 760px)',
    minWidth: '0',
    margin: '0 auto',
    padding: '40px 0 40vh',
    caretColor: 'var(--accent)',
  },
  // With line numbers on, the gutter and the column are centered as one unit,
  // keeping .cm-content horizontal padding at 0 so selection stays flush.
  '.cm-gutters + .cm-content': {
    marginInlineStart: '0',
    flexBasis: 'var(--prose-width, 760px)',
    maxWidth: 'var(--prose-width, 760px)',
  },
  '.cm-line': { padding: '0' },
  '&.cm-aster-prose .cm-line:not(.aster-lp-codeline):not(.aster-lp-heading)': {
    paddingBlock: '0.09em',
  },
  '&.cm-aster-prose .cm-line.aster-lp-h1': {
    paddingTop: '0.62em',
    paddingBottom: '0.22em',
  },
  '&.cm-aster-prose .cm-line.aster-lp-h2': {
    paddingTop: '0.56em',
    paddingBottom: '0.18em',
  },
  '&.cm-aster-prose .cm-line.aster-lp-h3': {
    paddingTop: '0.46em',
    paddingBottom: '0.14em',
  },
  '&.cm-aster-prose .cm-line.aster-lp-h4, &.cm-aster-prose .cm-line.aster-lp-h5, &.cm-aster-prose .cm-line.aster-lp-h6': {
    paddingTop: '0.34em',
    paddingBottom: '0.1em',
  },
  '&.cm-aster-prose .cm-content > .cm-line:first-child': {
    paddingTop: '0',
  },
  '.aster-cjk-gap-after': {
    paddingInlineEnd: '0.12em',
  },
  '.cm-line.aster-focus-dim': {
    opacity: '0.32',
    transition: 'opacity 140ms ease',
  },
  '&.cm-aster-read .cm-cursor, &.cm-aster-read .cm-dropCursor': {
    display: 'none !important',
  },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': {
    marginInlineStart: 'auto',
    paddingInlineEnd: '12px',
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
    // Same line box as body text (the number is 0.8x its size), so the number
    // sits on the vertical middle of the line's first visual row.
    lineHeight: 'calc(var(--editor-line-height, 1.75) / 0.8 * 1em)',
  },
  '.cm-lineNumbers .cm-gutterElement.aster-gutter-heading': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: 'none' },
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
