import { describe, it, expect } from 'vitest';
import {
  createEditor,
  applyEditorSearch,
  clearEditorSearch,
  findNextMatch,
  findPrevMatch,
  replaceCurrentMatch,
  replaceAllMatches,
} from '../src';

describe('search-ctrl', () => {
  it('counts matches, steps next/prev, replaces single and all, and clears highlights', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ed = createEditor(host, { initialContent: 'alpha beta alpha gamma' });

    const stats = applyEditorSearch(ed.view, { search: 'alpha', replace: 'omega' });
    expect(stats).toEqual({ total: 2, current: 1, valid: true });

    expect(findNextMatch(ed.view)).toBe(true);
    expect(ed.view.state.selection.main.from).toBe(0);

    expect(findNextMatch(ed.view)).toBe(true);
    expect(ed.view.state.selection.main.from).toBe(11);

    expect(findPrevMatch(ed.view)).toBe(true);
    expect(ed.view.state.selection.main.from).toBe(0);

    expect(replaceCurrentMatch(ed.view)).toBe(true);
    expect(ed.getContent()).toBe('omega beta alpha gamma');

    applyEditorSearch(ed.view, { search: 'alpha', replace: 'delta' });
    expect(replaceAllMatches(ed.view)).toBe(true);
    expect(ed.getContent()).toBe('omega beta delta gamma');

    clearEditorSearch(ed.view);
    ed.destroy();
    host.remove();
  });
});
