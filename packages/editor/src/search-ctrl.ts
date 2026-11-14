import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  openSearchPanel,
  closeSearchPanel,
  searchPanelOpen,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from '@codemirror/search';

export interface SearchSpec {
  search: string;
  replace?: string;
  caseSensitive?: boolean;
  regexp?: boolean;
  wholeWord?: boolean;
}

export interface SearchStats {
  total: number;
  current: number;
  valid: boolean;
}

/**
 * Push a SearchQuery into CodeMirror's search state so `.cm-searchMatch` and
 * `.cm-searchMatch-selected` decorations highlight matches across the editor.
 */
export function applyEditorSearch(view: EditorView, spec: SearchSpec): SearchStats {
  if (!spec.search) {
    clearEditorSearch(view);
    return { total: 0, current: 0, valid: true };
  }
  if (!searchPanelOpen(view.state)) {
    openSearchPanel(view);
  }
  const query = new SearchQuery({
    search: spec.search,
    replace: spec.replace ?? '',
    caseSensitive: !!spec.caseSensitive,
    regexp: !!spec.regexp,
    wholeWord: !!spec.wholeWord,
  });
  view.dispatch({ effects: setSearchQuery.of(query) });
  return countEditorMatches(view.state, query);
}

/** Clear active search highlights without moving the cursor. */
export function clearEditorSearch(view: EditorView): void {
  const cur = getSearchQuery(view.state);
  if (cur.search) {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
  }
  if (searchPanelOpen(view.state)) {
    closeSearchPanel(view);
  }
}

/** Compute total matches and 1-based index of the currently selected match. */
export function countEditorMatches(state: EditorState, explicitQuery?: SearchQuery): SearchStats {
  const q = explicitQuery ?? getSearchQuery(state);
  if (!q.search) return { total: 0, current: 0, valid: true };
  if (!q.valid) return { total: 0, current: 0, valid: false };

  let total = 0;
  let current = 0;
  const sel = state.selection.main;
  const cursor = q.getCursor(state);
  // Cap scan at 10,000 matches so pathological regexes stay responsive.
  for (let next = cursor.next(); !next.done && total < 10000; next = cursor.next()) {
    total++;
    const { from, to } = next.value;
    if (current === 0 && from >= sel.from && (from === sel.from && to === sel.to || from <= sel.to)) {
      current = total;
    }
  }
  return { total, current: total > 0 && current === 0 ? 1 : current, valid: true };
}

export function findNextMatch(view: EditorView): boolean {
  return findNext(view);
}

export function findPrevMatch(view: EditorView): boolean {
  return findPrevious(view);
}

export function replaceCurrentMatch(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  return replaceNext(view);
}

export function replaceAllMatches(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  return replaceAll(view);
}
