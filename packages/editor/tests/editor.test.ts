import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { __computeDecorations } from '../src/live-preview';
import {
  toggleInline,
  insertLink,
  setHeading,
  toggleLinePrefix,
  continueMarkup,
  deleteMarkup,
} from '../src/formatting';
import { createEditor } from '../src/index';

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.destroy()); });

function makeView(doc: string, anchor: number, head = anchor, readOnly = false) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [markdown({ base: markdownLanguage }), EditorState.readOnly.of(readOnly)],
    }),
    parent: document.body,
  });
  ensureSyntaxTree(view.state, doc.length, 1000);
  views.push(view);
  return view;
}

/** Text that remains visible after live-preview decorations hide source markup. */
function visibleText(view: EditorView): string {
  const doc = view.state.doc.toString();
  const hidden: [number, number][] = [];
  const set = __computeDecorations(view);
  set.between(0, doc.length, (from, to, deco) => {
    if (!(deco.spec as any).widget && !(deco.spec as any).class) hidden.push([from, to]);
  });
  let out = '';
  for (let i = 0; i < doc.length; i++) {
    if (!hidden.some(([f, t]) => i >= f && i < t)) out += doc[i];
  }
  return out;
}

function classesAt(view: EditorView, pos: number): string[] {
  const out: string[] = [];
  __computeDecorations(view).between(pos, pos + 1, (from, to, deco) => {
    const cls = (deco.spec as any).class;
    if (cls && from <= pos && to > pos) out.push(...cls.split(' '));
  });
  return out;
}

const sel = (v: EditorView) => [v.state.selection.main.from, v.state.selection.main.to];

describe('live preview', () => {
  it('hides inline markup away from the cursor', () => {
    const doc = 'cursor here\n\nsome **bold** and *em* and `code` and ~~gone~~';
    const view = makeView(doc, 0);
    expect(visibleText(view)).toBe('cursor here\n\nsome bold and em and code and gone');
  });

  it('styles bold, italic, code and strike', () => {
    const doc = 'x\n\n**bold** *em* `code` ~~st~~';
    const view = makeView(doc, 0);
    const base = doc.indexOf('**bold**');
    expect(classesAt(view, base + 2)).toContain('aster-lp-strong');
    expect(classesAt(view, doc.indexOf('em*'))).toContain('aster-lp-em');
    expect(classesAt(view, doc.indexOf('code'))).toContain('aster-lp-code');
    expect(classesAt(view, doc.indexOf('st~~'))).toContain('aster-lp-strike');
  });

  it('reveals markup when the selection touches the construct', () => {
    const doc = 'some **bold** text';
    const view = makeView(doc, doc.indexOf('bold') + 1);
    expect(visibleText(view)).toBe(doc);
  });

  it('hides heading marks except on the cursor line', () => {
    const doc = '# Title\n\n## Sub\n\nbody';
    const away = makeView(doc, doc.length);
    expect(visibleText(away)).toBe('Title\n\nSub\n\nbody');
    expect(classesAt(away, 2)).toContain('aster-lp-h1');

    const on = makeView(doc, 3);
    expect(visibleText(on)).toBe('# Title\n\nSub\n\nbody');
    expect(classesAt(on, 0)).toContain('aster-lp-hash-hang');
  });

  it('shows link label and hides the url', () => {
    const doc = 'x\n\nsee [Aster](https://example.com) now';
    const view = makeView(doc, 0);
    expect(visibleText(view)).toBe('x\n\nsee Aster now');
    expect(classesAt(view, doc.indexOf('Aster'))).toContain('aster-lp-link');
  });

  it('hides quote marks and styles the quote', () => {
    const doc = 'x\n\n> quoted line';
    const view = makeView(doc, 0);
    expect(visibleText(view)).toBe('x\n\nquoted line');
    expect(classesAt(view, doc.indexOf('quoted'))).toContain('aster-lp-quote');
  });

  it('does not touch markup inside fenced code blocks', () => {
    const doc = 'x\n\n```\n**not bold**\n```\n';
    const cursorInside = makeView(doc, doc.indexOf('not'));
    expect(visibleText(cursorInside)).toBe(doc);
  });

  it('replaces task markers with a checkbox widget', () => {
    const doc = 'x\n\n- [ ] todo\n- [x] done';
    const view = makeView(doc, 0);
    const widgets: number[] = [];
    __computeDecorations(view).between(0, doc.length, (from, _to, deco) => {
      if ((deco as any).widget?.constructor?.name === 'CheckboxWidget') widgets.push(from);
    });
    expect(widgets).toEqual([doc.indexOf('[ ]'), doc.indexOf('[x]')]);
  });
});

describe('formatting commands', () => {
  it('Mod-B wraps a selection in ** and unwraps it again', () => {
    const view = makeView('make bold here', 5, 9);
    toggleInline('**')(view);
    expect(view.state.doc.toString()).toBe('make **bold** here');
    expect(sel(view)).toEqual([7, 11]);
    toggleInline('**')(view);
    expect(view.state.doc.toString()).toBe('make bold here');
    expect(sel(view)).toEqual([5, 9]);
  });

  it('inline toggle on empty selection puts the cursor between markers', () => {
    const view = makeView('ab', 1);
    toggleInline('*')(view);
    expect(view.state.doc.toString()).toBe('a**b');
    expect(sel(view)).toEqual([2, 2]);
  });

  it('inline toggle unwraps when markers are included in the selection', () => {
    const view = makeView('x `code` y', 2, 8);
    toggleInline('`')(view);
    expect(view.state.doc.toString()).toBe('x code y');
  });

  it('does nothing in a read-only editor', () => {
    const view = makeView('locked', 0, 6, true);
    expect(toggleInline('**')(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('locked');
  });

  it('Mod-K wraps text in a link and selects the url placeholder', () => {
    const view = makeView('go home', 3, 7);
    insertLink(view);
    expect(view.state.doc.toString()).toBe('go [home](url)');
    expect(view.state.sliceDoc(...(sel(view) as [number, number]))).toBe('url');
  });

  it('setHeading sets, changes and clears heading level', () => {
    const view = makeView('Title', 0);
    setHeading(2)(view);
    expect(view.state.doc.toString()).toBe('## Title');
    setHeading(1)(view);
    expect(view.state.doc.toString()).toBe('# Title');
    setHeading(1)(view);
    expect(view.state.doc.toString()).toBe('Title');
  });

  it('toggles bullet lists across multiple lines', () => {
    const doc = 'one\ntwo';
    const view = makeView(doc, 0, doc.length);
    toggleLinePrefix('bullet')(view);
    expect(view.state.doc.toString()).toBe('- one\n- two');
    toggleLinePrefix('bullet')(view);
    expect(view.state.doc.toString()).toBe('one\ntwo');
  });

  it('numbers ordered lists and converts other list types', () => {
    const doc = '- a\n- b';
    const view = makeView(doc, 0, doc.length);
    toggleLinePrefix('ordered')(view);
    expect(view.state.doc.toString()).toBe('1. a\n2. b');
  });
});

describe('list continuation', () => {
  it('continues bullet and ordered lists on Enter', () => {
    const bullet = makeView('- item', 6);
    continueMarkup(bullet);
    expect(bullet.state.doc.toString()).toBe('- item\n- ');

    const ordered = makeView('3. item', 7);
    continueMarkup(ordered);
    expect(ordered.state.doc.toString()).toBe('3. item\n4. ');
  });

  it('continues task lists with an unchecked box', () => {
    const view = makeView('- [x] done', 10);
    continueMarkup(view);
    expect(view.state.doc.toString()).toBe('- [x] done\n- [ ] ');
  });

  it('ends the list when Enter is pressed on an empty item', () => {
    const view = makeView('- a\n- ', 6);
    continueMarkup(view);
    expect(view.state.doc.toString()).toBe('- a\n');
  });

  it('returns false on plain paragraphs so default Enter runs', () => {
    const view = makeView('plain', 5);
    expect(continueMarkup(view)).toBe(false);
  });

  it('Backspace after an empty marker removes it', () => {
    const view = makeView('  - ', 4);
    deleteMarkup(view);
    expect(view.state.doc.toString()).toBe('  ');
  });
});

describe('createEditor', () => {
  it('toggles read-only independently of mode', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = createEditor(el, { initialContent: 'hi', mode: 'live' });
    expect(ed.view.state.readOnly).toBe(false);
    ed.setReadOnly(true);
    expect(ed.view.state.readOnly).toBe(true);
    ed.setMode('source');
    expect(ed.view.state.readOnly).toBe(true);
    ed.setReadOnly(false);
    expect(ed.view.state.readOnly).toBe(false);
    ed.destroy();
  });

  it('keeps undo history across mode switches', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = createEditor(el, { initialContent: 'a' });
    ed.view.dispatch({ changes: { from: 1, insert: 'b' }, userEvent: 'input' });
    ed.setMode('source');
    ed.setMode('live');
    expect(ed.getContent()).toBe('ab');
    // undo via the history extension's command
    return import('@codemirror/commands').then(({ undo }) => {
      undo(ed.view);
      expect(ed.getContent()).toBe('a');
      ed.destroy();
    });
  });
});

describe('code block renderers', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('renders a fenced block through the renderer hook', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const seen: [string, string][] = [];
    const ed = createEditor(el, {
      initialContent: 'x\n\n```math\na^2\n```\n',
      renderCodeBlock: (lang, body) => {
        seen.push([lang, body]);
        return lang === 'math' ? Promise.resolve(`<span class="rendered">${body}</span>`) : null;
      },
    });
    await tick();
    expect(seen).toEqual([['math', 'a^2']]);
    expect(el.querySelector('.aster-lp-rendered .rendered')?.textContent).toBe('a^2');
    ed.destroy();
  });

  it('falls back to a plain code block when no renderer exists', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = createEditor(el, { initialContent: 'x\n\n```js\nlet a\n```\n', renderCodeBlock: () => null });
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector('.aster-lp-codeblock')?.textContent).toContain('let a');
    expect(el.querySelector('.aster-lp-render-error')).toBeNull();
    ed.destroy();
  });

  it('shows an error under the source when rendering fails', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = createEditor(el, {
      initialContent: 'x\n\n```mermaid\nnot a diagram\n```\n',
      renderCodeBlock: () => Promise.reject(new Error('Parse error')),
    });
    await tick();
    expect(el.querySelector('.aster-lp-render-error')?.textContent).toBe('mermaid: Parse error');
    expect(el.querySelector('.aster-lp-codeblock code')?.textContent).toBe('not a diagram');
    ed.destroy();
  });

  it('keeps math/mermaid steady-state on cursor pass-through and opens stacked micro-panel on Edit Source', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const doc = '```math\na^2\n```\n\nafter';
    const ed = createEditor(el, { initialContent: doc, renderCodeBlock: () => Promise.resolve('<b>r</b>') });
    await tick();
    // Passing cursor onto the math block keeps it steady-state rendered (no jank collapse)
    ed.view.dispatch({ selection: { anchor: doc.indexOf('a^2') } });
    expect(el.querySelector('.aster-lp-rendered.is-selected')).not.toBeNull();
    expect(el.querySelector('.aster-lp-rendered-body b')?.textContent).toBe('r');

    // Clicking "编辑源码" opens native source lines + live preview micro-panel below
    (el.querySelector('.aster-lp-edit-btn') as HTMLButtonElement).click();
    await tick();
    expect(el.querySelector('.cm-content')?.textContent).toContain('```math');
    expect(el.querySelector('.aster-lp-micro-panel .aster-lp-micro-preview b')?.textContent).toBe('r');

    // Clicking "完成 (Esc)" folds back into steady-state rendered view
    (el.querySelector('.aster-lp-done-btn') as HTMLButtonElement).click();
    await tick();
    expect(el.querySelector('.aster-lp-micro-panel')).toBeNull();
    expect(el.querySelector('.aster-lp-rendered')).not.toBeNull();
    ed.destroy();
  });

  it('renders a copy button on plain code blocks', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = createEditor(el, { initialContent: 'x\n\n```ts\nconst x = 1;\n```\n', renderCodeBlock: () => null });
    await tick();
    expect(el.querySelector('.aster-lp-codeblock .aster-lp-codelang')?.textContent).toBe('ts');
    expect(el.querySelector('.aster-lp-codeblock .aster-lp-copy-btn')).not.toBeNull();
    ed.destroy();
  });
});

describe('extended markdown syntax (math, frontmatter, callouts, highlight, footnotes)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('renders inline $...$ and block $$...$$ math while ignoring currency like $100 and $200', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const seen: [string, string][] = [];
    const doc = 'Intro\n\nPrice is $100 and $200, while $E=mc^2$ is inline.\n\n$$\n\\int_0^1 x\\,dx\n$$\n';
    const ed = createEditor(el, {
      initialContent: doc,
      renderCodeBlock: (lang, body) => {
        seen.push([lang, body]);
        return Promise.resolve(`<span class="k-${lang}">${body}</span>`);
      },
    });
    await tick();
    expect(seen).toContainEqual(['math', '\\int_0^1 x\\,dx']);
    expect(seen).toContainEqual(['math-inline', 'E=mc^2']);
    expect(el.querySelector('.aster-lp-math-inline .k-math-inline')?.textContent).toBe('E=mc^2');
    // Currency $100 and $200 must NOT be turned into math widgets
    expect(seen.some(([, b]) => b.includes('100'))).toBe(false);
    ed.destroy();
  });

  it('folds YAML frontmatter at line 1 into a metadata card when cursor is away', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const doc = '---\ntitle: Aster v2\ntags:\n  - markdown\n  - rust\n---\n\n# Heading\n';
    const ed = createEditor(el, { initialContent: doc });
    // Move cursor to `# Heading`
    ed.view.dispatch({ selection: { anchor: doc.indexOf('# Heading') + 2 } });
    const fm = el.querySelector('.aster-lp-frontmatter');
    expect(fm).not.toBeNull();
    expect(fm?.textContent).toContain('title');
    expect(fm?.textContent).toContain('Aster v2');
    expect(fm?.textContent).toContain('markdown, rust');
    ed.destroy();
  });

  it('renders GitHub Callouts, ==highlight==, and [^1] footnotes', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const doc = 'Cursor line\n\n> [!WARNING] Careful\n> Watch out\n\nVery ==important== note[^1].\n\n[^1]: Footnote body\n';
    const ed = createEditor(el, { initialContent: doc });
    expect(el.querySelector('.aster-lp-callout-title.aster-lp-callout-warning')?.textContent).toContain('Careful');
    expect(classesAt(ed.view, doc.indexOf('important') + 2)).toContain('aster-lp-highlight');
    expect(visibleText(ed.view)).not.toContain('==important==');
    expect(el.querySelector('sup.aster-lp-fnref')?.textContent).toBe('[1]');
    expect(el.querySelector('.aster-lp-fndef-badge')?.textContent).toBe('[1]');
    ed.destroy();
  });
});

describe('programmatic search & replace controller', () => {
  it('counts matches, navigates, and replaces cleanly', async () => {
    const {
      applyEditorSearch, findNextMatch, replaceCurrentMatch, replaceAllMatches, clearEditorSearch,
    } = await import('../src/search-ctrl');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = createEditor(el, { initialContent: 'foo bar foo baz foo' });
    const stats = applyEditorSearch(ed.view, { search: 'foo', replace: 'qux' });
    expect(stats).toEqual({ total: 3, current: 1, valid: true });
    findNextMatch(ed.view);
    replaceCurrentMatch(ed.view);
    expect(ed.getContent()).toBe('qux bar foo baz foo');
    replaceAllMatches(ed.view);
    expect(ed.getContent()).toBe('qux bar qux baz qux');
    clearEditorSearch(ed.view);
    ed.destroy();
  });
});

describe('ordered list nesting', () => {
  const run = async (doc: string, line: number, dir: 1 | -1) => {
    const { indentList } = await import('../src/lists');
    const view = makeView(doc, doc.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0) + 3);
    indentList(dir)(view);
    return view.state.doc.toString();
  };

  it('indenting an item starts a sublist at 1 and renumbers the parent', async () => {
    const doc = '1. a\n2. b\n3. c\n4. d';
    expect(await run(doc, 3, 1)).toBe('1. a\n2. b\n   1. c\n3. d');
  });

  it('indents under the sibling content column, not by a fixed width', async () => {
    const doc = '9. a\n10. b\n11. c';
    expect(await run(doc, 3, 1)).toBe('9. a\n10. b\n    1. c');
  });

  it('continues an existing sublist when indenting the next item', async () => {
    const doc = '1. a\n   1. x\n2. b\n3. c';
    expect(await run(doc, 3, 1)).toBe('1. a\n   1. x\n   2. b\n2. c');
  });

  it('outdenting returns an item to the parent level and renumbers both', async () => {
    const doc = '1. a\n   1. x\n   2. y\n2. b';
    expect(await run(doc, 3, -1)).toBe('1. a\n   1. x\n2. y\n3. b');
  });

  it('moves children with their item', async () => {
    const doc = '1. a\n2. b\n   1. child\n3. c';
    expect(await run(doc, 2, 1)).toBe('1. a\n   1. b\n      1. child\n2. c');
  });

  it('does not indent the first item of a list', async () => {
    expect(await run('1. a\n2. b', 1, 1)).toBe('1. a\n2. b');
  });

  it('leaves bullets alone but nests them', async () => {
    expect(await run('- a\n- b', 2, 1)).toBe('- a\n  - b');
  });

  it('Enter on an empty nested item outdents it', () => {
    const doc = '1. a\n   1. ';
    const view = makeView(doc, doc.length);
    continueMarkup(view);
    expect(view.state.doc.toString()).toBe('1. a\n2. ');
  });

  it('Enter in the middle of a numbered list renumbers the rest', () => {
    const doc = '1. a\n2. b\n3. c';
    const view = makeView(doc, 4);
    continueMarkup(view);
    expect(view.state.doc.toString()).toBe('1. a\n2. \n3. b\n4. c');
  });
});

describe('render cache', () => {
  it('re-renders after a cache-clearing refresh (theme change)', async () => {
    const { refreshCodeBlocks } = await import('../src/live-preview');
    const el = document.createElement('div');
    document.body.appendChild(el);
    let calls = 0;
    const ed = createEditor(el, {
      initialContent: 'x\n\n```mermaid\ngraph LR\n```\n',
      renderCodeBlock: () => { calls++; return Promise.resolve(`<svg data-n="${calls}"></svg>`); },
    });
    await new Promise((r) => setTimeout(r, 0));
    refreshCodeBlocks(ed.view); // plain refresh: served from cache
    expect(calls).toBe(1);
    refreshCodeBlocks(ed.view, { clearCache: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
    expect(el.querySelector('svg')?.getAttribute('data-n')).toBe('2');
    ed.destroy();
  });
});

describe('highlight colors', () => {
  it('selection matches and search results use theme tokens, not CodeMirror defaults', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ed = createEditor(el, { initialContent: 'word word' });
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toMatch(/cm-selectionMatch[^}]*var\(--selection-match\)/);
    expect(css).toMatch(/cm-searchMatch[^}]*var\(--search-match\)/);
    ed.destroy();
  });
});

describe('outline', () => {
  it('lists h1-h3 with markup stripped and ignores code blocks, and supports h1-h6 when requested', async () => {
    const { outline } = await import('../src/outline');
    const doc = '# One **b**\n\ntext\n\n## Two `c`\n\n```\n# not a heading\n```\n\n### Three\n\n#### Four\n\nSet\n===\n';
    const view = makeView(doc, 0);
    expect(outline(view.state).map((h) => [h.level, h.text])).toEqual([
      [1, 'One b'], [2, 'Two c'], [3, 'Three'], [1, 'Set'],
    ]);
    expect(outline(view.state, 6).map((h) => [h.level, h.text])).toEqual([
      [1, 'One b'], [2, 'Two c'], [3, 'Three'], [4, 'Four'], [1, 'Set'],
    ]);
  });
});

describe('read mode, CJK autospace and paragraph focus', () => {
  it('freezes all markdown syntax expansion in read mode even when selection touches constructs', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const doc = '# Title\n\nsome **bold** and [Aster](https://example.com) text';
    const ed = createEditor(el, { initialContent: doc, mode: 'read' });
    expect(ed.view.state.readOnly).toBe(true);
    // Move selection right onto heading and bold text
    ed.view.dispatch({ selection: { anchor: 2, head: doc.indexOf('bold') + 3 } });
    expect(visibleText(ed.view)).toBe('Title\n\nsome bold and Aster text');
    // Switching back to live mode reveals touched construct
    ed.setMode('live');
    expect(ed.view.state.readOnly).toBe(false);
    ed.view.dispatch({ selection: { anchor: doc.indexOf('bold') + 1 } });
    expect(visibleText(ed.view)).toContain('**bold**');
    ed.destroy();
  });

  it('adds non-destructive CJK–Latin visual autospace outside code and URLs', async () => {
    const { __computeCjkDecorations } = await import('../src/immersive');
    const doc = '使用Aster在2026年写 `中文Code` 和 [链接Text](https://example.com/中A文)';
    const view = makeView(doc, 0);
    const set = __computeCjkDecorations(view.state);
    const gapPositions: number[] = [];
    set.between(0, doc.length, (from) => { gapPositions.push(from); });
    // Boundaries in prose: 用|A, r|在, 在|2, 6|年, 接|T
    expect(gapPositions).toContain(doc.indexOf('用Aster'));
    expect(gapPositions).toContain(doc.indexOf('r在'));
    expect(gapPositions).toContain(doc.indexOf('在2026'));
    expect(gapPositions).toContain(doc.indexOf('6年'));
    // Must NOT add gaps inside `中文Code` or inside URL `https://example.com/中A文`
    expect(gapPositions).not.toContain(doc.indexOf('文Code'));
    expect(gapPositions).not.toContain(doc.indexOf('中A文'));
    // Underlying document text is untouched
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('dims non-active paragraphs in focus mode', async () => {
    const { __computeFocusDecorations } = await import('../src/immersive');
    const doc = 'First paragraph\n\nSecond paragraph\nline two\n\nThird paragraph';
    const view = makeView(doc, doc.indexOf('Second') + 2);
    const set = __computeFocusDecorations(view.state);
    const dimmedLines: number[] = [];
    set.between(0, doc.length, (from) => { dimmedLines.push(view.state.doc.lineAt(from).number); });
    expect(dimmedLines).toContain(1); // First paragraph dimmed
    expect(dimmedLines).not.toContain(3); // Second paragraph active
    expect(dimmedLines).not.toContain(4); // Second paragraph line 2 active
    expect(dimmedLines).toContain(6); // Third paragraph dimmed
  });

  it('wraps selected text on URL paste and forwards pasted images to onPasteImage', () => {
    const pastedFiles: File[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ed = createEditor(container, {
      initialContent: 'Visit Aster today',
      onPasteImage: (f) => { pastedFiles.push(f); },
    });

    // Select `Aster` (offset 6..11) and paste an HTTPS URL
    ed.view.dispatch({ selection: { anchor: 6, head: 11 } });
    const urlEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(urlEvent, 'clipboardData', {
      value: {
        files: [],
        items: [],
        getData: (t: string) => (t === 'text/plain' ? 'https://aster.app/docs' : ''),
      },
    });
    ed.view.contentDOM.dispatchEvent(urlEvent);
    expect(ed.getContent()).toBe('Visit [Aster](https://aster.app/docs) today');

    // Paste an image File
    const mockFile = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
    const imgEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(imgEvent, 'clipboardData', {
      value: {
        files: [mockFile],
        items: [],
        getData: () => '',
      },
    });
    ed.view.contentDOM.dispatchEvent(imgEvent);
    expect(pastedFiles).toHaveLength(1);
    expect(pastedFiles[0].name).toBe('shot.png');

    ed.destroy();
    container.remove();
  });

  it('keeps horizontal padding on .cm-scroller instead of .cm-content so drawSelection starts flush at column 0', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ed = createEditor(container, { initialContent: '# Title\n\nBody text', lineNumbers: true });
    const contentStyle = window.getComputedStyle(ed.view.contentDOM);
    const scrollerStyle = window.getComputedStyle(ed.view.scrollDOM);
    expect(contentStyle.paddingLeft).toBe('0px');
    expect(contentStyle.paddingRight).toBe('0px');
    expect(scrollerStyle.paddingInline).toBe('32px');
    ed.destroy();
    container.remove();
  });
});
