import { EditorState, Extension, StateField, StateEffect, Range } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, GutterMarker, gutterLineClass } from '@codemirror/view';
import { RangeSet } from '@codemirror/state';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import type { SyntaxNode } from '@lezer/common';

/**
 * Live preview: markdown is shown rendered, with its markup hidden. A construct
 * that the selection touches is revealed as source so it can be edited.
 *
 * Built on the @lezer/markdown syntax tree (not regexes), so code blocks,
 * escapes and nesting are handled correctly. It is a StateField rather than a
 * ViewPlugin because block widgets (fenced code) replace line breaks, which
 * CodeMirror only allows from state fields.
 */

// Inline delimiters hidden whenever their parent construct is not being edited.
const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark']);

const INLINE_STYLE: Record<string, string> = {
  Emphasis: 'aster-lp-em',
  StrongEmphasis: 'aster-lp-strong',
  Strikethrough: 'aster-lp-strike',
  InlineCode: 'aster-lp-code',
};

function build(state: EditorState): DecorationSet {
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 50) ?? syntaxTree(state);
  const ranges = state.selection.ranges;

  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
  const lineTouched = (pos: number) => {
    const line = doc.lineAt(pos);
    return touches(line.from, line.to);
  };

  const out: Range<Decoration>[] = [];
  const hide = (from: number, to: number) => {
    if (from < to) out.push(Decoration.replace({}).range(from, to));
  };
  const hideWithSpace = (n: SyntaxNode) => {
    const end = doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to;
    hide(n.from, end);
  };
  const mark = (from: number, to: number, cls: string) => {
    if (from < to) out.push(Decoration.mark({ class: cls }).range(from, to));
  };
  const lineClass = (pos: number, cls: string) => {
    out.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  };

  tree.iterate({
    enter(ref) {
      const node = ref.node;
      const { name, from, to } = ref;

      // ── Headings ───────────────────────────────────────────────
      if (name.startsWith('ATXHeading')) {
        const level = name.slice('ATXHeading'.length);
        lineClass(from, `aster-lp-heading aster-lp-h${level}`);
        mark(from, to, `aster-lp-heading aster-lp-h${level}`);
        if (!lineTouched(from)) {
          const hm = node.getChild('HeaderMark');
          if (hm && hm.from === doc.lineAt(from).from) hideWithSpace(hm);
          // Optional closing hashes: "## Title ##"
          const marks = node.getChildren('HeaderMark');
          if (marks.length > 1) hide(marks[marks.length - 1].from - 1, marks[marks.length - 1].to);
        }
        return true; // descend: inline formatting inside headings
      }
      if (name === 'SetextHeading1' || name === 'SetextHeading2') {
        const lv = name.endsWith('1') ? 1 : 2;
        lineClass(from, `aster-lp-heading aster-lp-h${lv}`);
        mark(from, to, `aster-lp-heading aster-lp-h${lv}`);
        for (const hm of node.getChildren('HeaderMark')) {
          if (!lineTouched(hm.from)) hide(doc.lineAt(hm.from).from - 1, hm.to);
        }
        return true;
      }

      // ── Block widgets ──────────────────────────────────────────
      if (name === 'HorizontalRule') {
        if (!touches(from, to)) out.push(Decoration.replace({ widget: new HrWidget() }).range(from, to));
        return false;
      }
      if (name === 'FencedCode') {
        if (!touches(from, to)) {
          const info = node.getChild('CodeInfo');
          const lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0].toLowerCase() : '';
          const text = node.getChild('CodeText');
          const body = text ? doc.sliceString(text.from, text.to) : '';
          out.push(Decoration.replace({ widget: new CodeBlockWidget(body, lang), block: true }).range(from, to));
        } else {
          for (let p = from; p <= to; ) {
            const line = doc.lineAt(p);
            lineClass(line.from, 'aster-lp-codeline');
            p = line.to + 1;
          }
        }
        return false;
      }
      if (name === 'CodeBlock') {
        for (let p = from; p <= to; ) {
          const line = doc.lineAt(p);
          lineClass(line.from, 'aster-lp-codeline');
          p = line.to + 1;
        }
        return false;
      }

      // ── Tables ─────────────────────────────────────────────────
      if (name === 'Table') {
        if (!touches(from, to)) {
          out.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(from, to), from), block: true }).range(from, to));
        }
        return false;
      }

      // ── Quotes ─────────────────────────────────────────────────
      if (name === 'Blockquote') {
        for (let p = from; p <= to; ) {
          const line = doc.lineAt(p);
          lineClass(line.from, 'aster-lp-quote-line');
          p = line.to + 1;
        }
        mark(from, to, 'aster-lp-quote');
        return true;
      }
      if (name === 'QuoteMark') {
        if (!lineTouched(from)) hideWithSpace(node);
        return false;
      }

      // ── Lists ──────────────────────────────────────────────────
      if (name === 'ListMark') {
        if (lineTouched(from)) return false;
        const item = node.parent;
        if (item?.getChild('Task')) {
          hideWithSpace(node); // the checkbox replaces the bullet
        } else if (/^\d/.test(doc.sliceString(from, to))) {
          mark(from, to, 'aster-lp-ordered');
        } else {
          out.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
        }
        return false;
      }
      if (name === 'TaskMarker') {
        if (!touches(from, to)) {
          const checked = /x/i.test(doc.sliceString(from, to));
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked, from) }).range(from, to));
          if (checked) {
            const task = node.parent!;
            mark(to, task.to, 'aster-lp-task-done');
          }
        }
        return false;
      }

      // ── Inline ─────────────────────────────────────────────────
      if (name in INLINE_STYLE) {
        mark(from, to, INLINE_STYLE[name]);
        if (!touches(from, to)) {
          for (let c = node.firstChild; c; c = c.nextSibling) {
            if (INLINE_MARKS.has(c.name)) hide(c.from, c.to);
          }
        }
        return true;
      }

      if (name === 'Link') {
        const marks = node.getChildren('LinkMark');
        const url = node.getChild('URL');
        // Inline link: [label](url) → marks '[' ']' '(' ')'
        if (marks.length >= 2) {
          mark(marks[0].to, marks[1].from, 'aster-lp-link');
          if (!touches(from, to)) {
            hide(marks[0].from, marks[0].to);
            hide(marks[1].from, to);
          }
        } else if (url) {
          mark(url.from, url.to, 'aster-lp-link');
        }
        return false;
      }

      if (name === 'Image') {
        if (!touches(from, to)) {
          const marks = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : '';
          const src = url ? doc.sliceString(url.from, url.to) : '';
          out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(from, to));
        }
        return false;
      }

      if (name === 'URL' || name === 'Autolink') {
        const p = node.parent?.name;
        if (p !== 'Link' && p !== 'Image') mark(from, to, 'aster-lp-link');
        return false;
      }

      return true;
    },
  });

  return Decoration.set(out, true);
}

/** Minimal inline markdown for table cells: code, bold, italic, strike, links. Escapes everything else. */
function inlineHtml(src: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const codes: string[] = [];
  let s = src.replace(/\\\|/g, '|').replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      /^(https?:|mailto:|#|\.{0,2}\/)/i.test(href) ? `<a href="${href}">${label}</a>` : label);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

function splitCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (t[i] === '|') { out.push(cur.trim()); cur = ''; continue; }
    cur += t[i];
  }
  out.push(cur.trim());
  return out;
}

/** GFM table rendered as a grid. Clicking a cell puts the cursor in that cell's source. */
class TableWidget extends WidgetType {
  constructor(readonly src: string, readonly pos: number) { super(); }
  eq(o: TableWidget) { return o.src === this.src && o.pos === this.pos; }
  toDOM(view: EditorView) {
    const lines = this.src.split('\n');
    const align = splitCells(lines[1] ?? '').map((c) => {
      const l = c.startsWith(':'), r = c.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
    });
    const wrap = document.createElement('div');
    wrap.className = 'aster-lp-table';
    const table = document.createElement('table');
    // Offset of each source line within the document, for click-to-edit.
    const lineStarts: number[] = [];
    let off = this.pos;
    for (const l of lines) { lineStarts.push(off); off += l.length + 1; }
    const cols = Math.max(...lines.filter((_, i) => i !== 1).map((l) => splitCells(l).length));
    lines.forEach((line, li) => {
      if (li === 1) return;
      const tr = document.createElement('tr');
      const cells = splitCells(line);
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement(li === 0 ? 'th' : 'td');
        cell.innerHTML = inlineHtml(cells[c] ?? '');
        if (align[c]) cell.style.textAlign = align[c];
        cell.addEventListener('mousedown', (e) => {
          if ((e.target as HTMLElement).closest('a')) return;
          e.preventDefault();
          // Find the c-th cell's content end on this source line.
          const text = line;
          let i = text.length - text.trimStart().length;
          if (text[i] === '|') i++;
          for (let k = 0; k < c && i < text.length; i++) {
            if (text[i] === '\\') { i++; continue; }
            if (text[i] === '|') k++;
          }
          let j = i;
          while (j < text.length && !(text[j] === '|' && text[j - 1] !== '\\')) j++;
          let end = j;
          while (end > i && text[end - 1] === ' ') end--;
          view.dispatch({ selection: { anchor: lineStarts[li] + Math.max(i, end) } });
          view.focus();
        });
        tr.appendChild(cell);
      }
      (li === 0 ? (table.createTHead()) : (table.tBodies[0] ?? table.createTBody())).appendChild(tr);
    });
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() { return true; }
}

class HrWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'aster-lp-hr';
    return el;
  }
  eq() { return true; }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'aster-lp-bullet';
    el.textContent = '•';
    return el;
  }
  eq() { return true; }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  toDOM(view: EditorView) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'aster-lp-checkbox';
    el.checked = this.checked;
    el.setAttribute('aria-label', this.checked ? 'Completed task' : 'Open task');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? '[ ]' : '[x]' },
        userEvent: 'input.toggleTask',
      });
    });
    return el;
  }
  eq(o: CheckboxWidget) { return o.checked === this.checked && o.pos === this.pos; }
  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) { super(); }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'aster-lp-image';
    const img = document.createElement('img');
    img.src = imageResolver ? imageResolver(this.src) : this.src;
    img.alt = this.alt;
    img.addEventListener('error', () => {
      wrap.classList.add('aster-lp-image-broken');
      wrap.textContent = this.alt || this.src;
    }, { once: true });
    wrap.appendChild(img);
    return wrap;
  }
  eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt; }
}

/**
 * Renders a fenced block's body to HTML, e.g. via a plugin. Return null
 * (synchronously or from the promise) to fall back to a plain code block.
 */
export type CodeBlockRenderer = (lang: string, body: string) => Promise<string | null> | null;

let codeRenderer: CodeBlockRenderer | null = null;
const renderCache = new Map<string, string>();
const RENDER_CACHE_MAX = 200;
// Bumped by refreshCodeBlocks so existing widgets re-render (eq() fails).
let renderGeneration = 0;
/** Bumped on theme change so cached SVGs from a previous palette are not reused. */
let themeGeneration = 0;

const langCache = new Map<string, Promise<import('@lezer/common').Parser | null>>();

function parserFor(lang: string): Promise<import('@lezer/common').Parser | null> {
  const key = lang.toLowerCase();
  let p = langCache.get(key);
  if (!p) {
    const desc = LanguageDescription.matchLanguageName(languages, key, true);
    p = desc
      ? desc.load().then((s) => s.language.parser).catch(() => null)
      : Promise.resolve(null);
    langCache.set(key, p);
  }
  return p;
}

function highlightedCode(body: string, parser: import('@lezer/common').Parser): HTMLElement {
  const code = document.createElement('code');
  const tree = parser.parse(body);
  let line: HTMLSpanElement | null = null;
  const ensure = () => {
    if (!line) { line = document.createElement('span'); line.className = 'tok-line'; code.appendChild(line); }
    return line;
  };
  highlightCode(body, tree, classHighlighter, (text, cls) => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    ensure().appendChild(span);
  }, () => {
    code.appendChild(document.createTextNode('\n'));
    line = null;
  });
  return code;
}

function plainCodeBlock(body: string, lang: string, parser: import('@lezer/common').Parser | null = null): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'aster-lp-codeblock';
  if (lang) {
    const badge = document.createElement('span');
    badge.className = 'aster-lp-codelang';
    badge.textContent = lang;
    pre.appendChild(badge);
  }
  if (parser) pre.appendChild(highlightedCode(body, parser));
  else {
    const code = document.createElement('code');
    code.textContent = body;
    pre.appendChild(code);
  }
  return pre;
}

class CodeBlockWidget extends WidgetType {
  readonly gen = renderGeneration;
  constructor(readonly body: string, readonly lang: string) { super(); }
  toDOM(view: EditorView) {
    const key = `${themeGeneration}\u0000${this.lang}\u0000${this.body}`;
    const cached = renderCache.get(key);
    if (cached !== undefined) {
      const wrap = document.createElement('div');
      wrap.className = 'aster-lp-rendered';
      wrap.innerHTML = cached;
      return wrap;
    }
    const plugin = this.lang && codeRenderer ? codeRenderer(this.lang, this.body) : null;
    const syntax = this.lang ? parserFor(this.lang) : Promise.resolve(null);
    const wrap = document.createElement('div');
    wrap.className = 'aster-lp-rendered is-pending';
    wrap.appendChild(plainCodeBlock(this.body, this.lang));
    Promise.all([plugin ?? Promise.resolve(null), syntax]).then(
      ([html, parser]) => {
        wrap.classList.remove('is-pending');
        if (html != null) {
          if (renderCache.size >= RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value!);
          renderCache.set(key, html);
          wrap.innerHTML = html;
        } else if (parser) {
          wrap.replaceChildren(plainCodeBlock(this.body, this.lang, parser));
        }
        view.requestMeasure();
      },
      (err) => {
        wrap.classList.remove('is-pending');
        const msg = document.createElement('div');
        msg.className = 'aster-lp-render-error';
        msg.textContent = `${this.lang}: ${err instanceof Error ? err.message : String(err)}`;
        wrap.appendChild(msg);
        view.requestMeasure();
      },
    );
    return wrap;
  }
  eq(o: CodeBlockWidget) { return o.body === this.body && o.lang === this.lang && o.gen === this.gen; }
}

const refreshEffect = StateEffect.define<null>();

/**
 * Re-render fenced code blocks, e.g. after a renderer plugin finished loading
 * or the theme changed. With clearCache, previously rendered output is dropped.
 */
export function refreshCodeBlocks(view: EditorView, opts: { clearCache?: boolean } = {}): void {
  if (opts.clearCache) {
    renderCache.clear();
    themeGeneration++;
  }
  renderGeneration++;
  view.dispatch({ effects: refreshEffect.of(null) });
}

const livePreviewField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (
      tr.docChanged || tr.selection ||
      tr.effects.some((e) => e.is(refreshEffect)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return build(tr.state);
    }
    return value;
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    gutterLineClass.from(f, headingGutterClasses),
  ],
});

/** Marks the line-number cell of a heading line so the number centers on the (taller) heading. */
class HeadingGutter extends GutterMarker {
  elementClass = 'aster-gutter-heading';
  eq() { return true; }
}
const HEADING_GUTTER = new HeadingGutter();

function headingGutterClasses(set: DecorationSet) {
  // DecorationSet.between visits overlapping layers, not globally sorted ranges.
  // A heading has both line and mark decorations; emit one sorted gutter marker.
  const positions = new Set<number>();
  set.between(0, 1e9, (from, _to, deco) => {
    const spec = deco.spec as { class?: string };
    if (!spec.class || !spec.class.includes('aster-lp-heading')) return;
    positions.add(from);
  });
  return RangeSet.of([...positions].map((from) => HEADING_GUTTER.range(from)), true);
}

export interface LivePreviewOptions {
  /** Map a markdown image src (possibly relative) to a URL the webview can load. */
  resolveImage?: (src: string) => string;
  /** Render fenced blocks such as ```math or ```mermaid. */
  renderCodeBlock?: CodeBlockRenderer;
}

export function livePreviewExtension(opts: LivePreviewOptions = {}): Extension {
  imageResolver = opts.resolveImage ?? null;
  codeRenderer = opts.renderCodeBlock ?? null;
  return livePreviewField;
}

let imageResolver: ((src: string) => string) | null = null;

/** Exposed for tests. */
export function __computeDecorations(target: EditorView | EditorState): DecorationSet {
  return build(target instanceof EditorView ? target.state : target);
}
