import { EditorSelection, EditorState, Extension, Facet, Range, RangeSet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, GutterMarker, gutterLineClass, keymap, WidgetType } from '@codemirror/view';
import { ensureSyntaxTree, LanguageDescription, syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';
import type { SyntaxNode } from '@lezer/common';
import { VisualTableWidget } from './table-widget';

/**
 * Zero-jank Live Preview built on `@lezer/markdown` + targeted block/inline extensions:
 * - Outdented hanging `#` heading markers in the left margin (zero horizontal text shift)
 * - Steady-state Mermaid, Math (`$$...$$` & ```math), and Visual Grid Tables
 * - Inline stacked source + live-preview micro-panel on explicit "Edit Source"
 * - Inline `$...$` KaTeX math, YAML Frontmatter card, GitHub Callouts, `==highlight==`, and `[^1]` footnotes
 */

const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark']);

const INLINE_STYLE: Record<string, string> = {
  Emphasis: 'aster-lp-em',
  StrongEmphasis: 'aster-lp-strong',
  Strikethrough: 'aster-lp-strike',
  InlineCode: 'aster-lp-code',
};

const STEADY_BLOCK_LANGS = new Set(['mermaid', 'math']);

const CALLOUT_LABELS: Record<string, { icon: string; label: string }> = {
  note: { icon: 'ℹ', label: 'Note' },
  tip: { icon: '✦', label: 'Tip' },
  important: { icon: '◆', label: 'Important' },
  warning: { icon: '▲', label: 'Warning' },
  caution: { icon: '⊗', label: 'Caution' },
};

const freezeMarkupFacet = Facet.define<boolean, boolean>({
  combine: (vals) => vals.some(Boolean),
});

/** Tracks the document start offset of a steady-state block explicitly opened for raw source editing. */
export const setEditingBlockEffect = StateEffect.define<number | null>();

const editingBlockField = StateField.define<number | null>({
  create: () => null,
  update(cur, tr) {
    for (const e of tr.effects) {
      if (e.is(setEditingBlockEffect)) return e.value;
    }
    if (cur === null) return null;
    const mapped = tr.changes.mapPos(cur, 1);
    if (tr.selection) {
      const doc = tr.state.doc;
      if (mapped < 0 || mapped > doc.length) return null;
      // Find block end from current state: if cursor moved completely outside the block's lines, close micro-panel.
      const blockEnd = findSteadyBlockEnd(tr.state, mapped);
      if (blockEnd !== null) {
        const sel = tr.state.selection.main;
        if (sel.to < mapped || sel.from > blockEnd) return null;
      } else {
        return null;
      }
    }
    return mapped;
  },
});

function findSteadyBlockEnd(state: EditorState, blockFrom: number): number | null {
  const doc = state.doc;
  if (blockFrom < 0 || blockFrom >= doc.length) return null;
  const firstLine = doc.lineAt(blockFrom);
  // $$...$$ block
  if (firstLine.text.trim().startsWith('$$')) {
    const trimmed = firstLine.text.trim();
    if (trimmed.length > 4 && trimmed.endsWith('$$')) return firstLine.to;
    for (let n = firstLine.number + 1; n <= doc.lines; n++) {
      if (doc.line(n).text.trim() === '$$') return doc.line(n).to;
    }
    return doc.length;
  }
  const tree = syntaxTree(state);
  let found: number | null = null;
  tree.iterate({
    from: blockFrom,
    to: Math.min(doc.length, blockFrom + 2),
    enter(ref) {
      if ((ref.name === 'FencedCode' || ref.name === 'Table') && ref.from === blockFrom) {
        found = ref.to;
        return false;
      }
      return true;
    },
  });
  return found;
}

/** Explicitly open a steady-state Mermaid / Math / Table block in inline source + preview mode. */
export function openBlockSourceEditor(view: EditorView, blockFrom: number): void {
  const doc = view.state.doc;
  if (blockFrom < 0 || blockFrom >= doc.length) return;
  const firstLine = doc.lineAt(blockFrom);
  const targetPos =
    firstLine.number < doc.lines && (firstLine.text.startsWith('```') || firstLine.text.trim() === '$$')
      ? doc.line(firstLine.number + 1).from
      : firstLine.from;
  view.dispatch({
    selection: EditorSelection.cursor(Math.min(targetPos, doc.length)),
    effects: setEditingBlockEffect.of(blockFrom),
    scrollIntoView: true,
  });
  view.focus();
}

/** Close the active inline source micro-panel and return to steady-state rendered view. */
export function closeBlockSourceEditor(view: EditorView): boolean {
  const activeFrom = view.state.field(editingBlockField, false) ?? null;
  if (activeFrom === null) return false;
  const end = findSteadyBlockEnd(view.state, activeFrom) ?? activeFrom;
  view.dispatch({
    selection: EditorSelection.cursor(Math.min(end, view.state.doc.length)),
    effects: setEditingBlockEffect.of(null),
  });
  view.focus();
  return true;
}

interface FrontmatterBlock {
  from: number;
  to: number;
  entries: [string, string][];
}

function detectFrontmatter(doc: EditorState['doc']): FrontmatterBlock | null {
  if (doc.lines < 2) return null;
  if (doc.line(1).text.trimEnd() !== '---') return null;
  let closeLineNum = -1;
  for (let n = 2; n <= Math.min(doc.lines, 80); n++) {
    const t = doc.line(n).text.trimEnd();
    if (t === '---' || t === '...') {
      closeLineNum = n;
      break;
    }
  }
  if (closeLineNum < 2) return null;

  const entries: [string, string][] = [];
  let sawValidLine = closeLineNum === 2;
  for (let n = 2; n < closeLineNum; n++) {
    const raw = doc.line(n).text;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = trimmed.match(/^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*:\s*(.*)$/);
    if (kv) {
      sawValidLine = true;
      entries.push([kv[1], kv[2].replace(/^['"]|['"]$/g, '').trim()]);
    } else if (/^-\s+/.test(trimmed) && entries.length > 0) {
      const prev = entries[entries.length - 1];
      prev[1] = prev[1] ? `${prev[1]}, ${trimmed.slice(2).trim()}` : trimmed.slice(2).trim();
    } else if (!sawValidLine) {
      // First non-empty line is plain prose rather than `key: value` -> treat `---` as a HorizontalRule!
      return null;
    }
  }
  if (!sawValidLine) return null;
  return { from: 0, to: doc.line(closeLineNum).to, entries };
}

interface MathBlockSpan {
  from: number;
  to: number;
  body: string;
}

function detectDollarMathBlocks(doc: EditorState['doc'], excluded: [number, number][]): MathBlockSpan[] {
  const isExcluded = (pos: number) => excluded.some(([f, t]) => pos >= f && pos <= t);
  const blocks: MathBlockSpan[] = [];
  let openLine = -1;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (isExcluded(line.from)) continue;
    const trimmed = line.text.trim();
    if (openLine === -1) {
      // Single-line $$ ... $$ block
      if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
        const inner = trimmed.slice(2, -2).trim();
        if (inner && !inner.includes('$$')) {
          blocks.push({ from: line.from, to: line.to, body: inner });
        }
      } else if (trimmed === '$$') {
        openLine = n;
      }
    } else if (trimmed === '$$') {
      const startLine = doc.line(openLine);
      const bodyLines: string[] = [];
      for (let k = openLine + 1; k < n; k++) bodyLines.push(doc.line(k).text);
      blocks.push({ from: startLine.from, to: line.to, body: bodyLines.join('\n') });
      openLine = -1;
    }
  }
  return blocks;
}

function build(state: EditorState, forceFreeze = false): DecorationSet {
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 50) ?? syntaxTree(state);
  const ranges = state.selection.ranges;
  const frozen = forceFreeze || state.facet(freezeMarkupFacet);
  const editingBlockFrom = frozen ? null : (state.field(editingBlockField, false) ?? null);

  const touches = (from: number, to: number) =>
    frozen ? false : ranges.some((r) => r.from <= to && r.to >= from);
  const lineTouched = (pos: number) => {
    if (frozen) return false;
    const line = doc.lineAt(pos);
    return touches(line.from, line.to);
  };

  const out: Range<Decoration>[] = [];
  const excludedInline: [number, number][] = [];
  const calloutHeaderReplacedLines = new Set<number>();

  const hide = (from: number, to: number) => {
    if (from < to) out.push(Decoration.replace({}).range(from, to));
  };
  const hideWithSpace = (n: SyntaxNode) => {
    const end = doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to;
    hide(n.from, end);
  };
  const mark = (from: number, to: number, cls: string, attributes?: Record<string, string>) => {
    if (from < to) out.push(Decoration.mark({ class: cls, attributes }).range(from, to));
  };
  const lineClass = (pos: number, cls: string) => {
    out.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  };

  // 1. Pre-scan code blocks from syntax tree so $$...$$ inside fenced code is never touched.
  const codeSpans: [number, number][] = [];
  const fm = detectFrontmatter(doc);
  if (fm) {
    codeSpans.push([fm.from, fm.to]);
    excludedInline.push([fm.from, fm.to]);
    if (frozen || (!touches(fm.from, fm.to) && editingBlockFrom !== fm.from)) {
      out.push(
        Decoration.replace({
          widget: new FrontmatterWidget(fm.entries, fm.from),
          block: true,
        }).range(fm.from, fm.to),
      );
    } else {
      for (let p = fm.from; p <= fm.to; ) {
        const line = doc.lineAt(p);
        lineClass(line.from, 'aster-lp-codeline aster-lp-frontmatter-line');
        p = line.to + 1;
      }
    }
  }

  tree.iterate({
    enter(ref) {
      if (fm && ref.from < fm.to) return false;
      if (ref.name === 'FencedCode' || ref.name === 'CodeBlock') {
        codeSpans.push([ref.from, ref.to]);
        excludedInline.push([ref.from, ref.to]);
        return false;
      }
      return true;
    },
  });

  // 2. Pre-scan $$...$$ display math blocks outside code blocks & frontmatter.
  const mathBlocks = detectDollarMathBlocks(doc, codeSpans);
  for (const mb of mathBlocks) {
    excludedInline.push([mb.from, mb.to]);
    const isEditingSrc = !frozen && editingBlockFrom === mb.from;
    if (!isEditingSrc) {
      const selected = !frozen && touches(mb.from, mb.to);
      out.push(
        Decoration.replace({
          widget: new CodeBlockWidget(mb.body, 'math', mb.from, true, frozen, selected),
          block: true,
        }).range(mb.from, mb.to),
      );
    } else {
      for (let p = mb.from; p <= mb.to; ) {
        const line = doc.lineAt(p);
        lineClass(line.from, 'aster-lp-codeline aster-lp-micro-srcline');
        p = line.to + 1;
      }
      out.push(
        Decoration.widget({
          widget: new MicroPreviewWidget(mb.body, 'math', mb.from),
          block: true,
          side: 1,
        }).range(mb.to),
      );
    }
  }

  const inPreHandledBlock = (from: number, to: number) =>
    (fm !== null && from < fm.to) || mathBlocks.some((mb) => from <= mb.to && to >= mb.from);

  // 3. Walk @lezer/markdown syntax tree.
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      const { name, from, to } = ref;
      if (inPreHandledBlock(from, to)) return name === 'Document';

      // ── Headings (with outdented left-margin `#` on active line) ──
      if (name.startsWith('ATXHeading')) {
        const level = name.slice('ATXHeading'.length);
        lineClass(from, `aster-lp-heading aster-lp-h${level}`);
        mark(from, to, `aster-lp-heading aster-lp-h${level}`);
        const hm = node.getChild('HeaderMark');
        const marks = node.getChildren('HeaderMark');
        if (!lineTouched(from)) {
          if (hm && hm.from === doc.lineAt(from).from) hideWithSpace(hm);
          if (marks.length > 1) hide(marks[marks.length - 1].from - 1, marks[marks.length - 1].to);
        } else if (hm && hm.from === doc.lineAt(from).from) {
          const end = doc.sliceString(hm.to, hm.to + 1) === ' ' ? hm.to + 1 : hm.to;
          mark(hm.from, end, 'aster-lp-hash-hang');
        }
        return true;
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
        excludedInline.push([from, to]);
        if (!touches(from, to)) out.push(Decoration.replace({ widget: new HrWidget() }).range(from, to));
        return false;
      }
      if (name === 'FencedCode') {
        const info = node.getChild('CodeInfo');
        const lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0].toLowerCase() : '';
        const text = node.getChild('CodeText');
        const body = text ? doc.sliceString(text.from, text.to) : '';
        const isSteadyDiagram = STEADY_BLOCK_LANGS.has(lang);

        if (isSteadyDiagram) {
          const isEditingSrc = !frozen && editingBlockFrom === from;
          if (!isEditingSrc) {
            const selected = !frozen && touches(from, to);
            out.push(
              Decoration.replace({
                widget: new CodeBlockWidget(body, lang, from, true, frozen, selected),
                block: true,
              }).range(from, to),
            );
          } else {
            for (let p = from; p <= to; ) {
              const line = doc.lineAt(p);
              lineClass(line.from, 'aster-lp-codeline aster-lp-micro-srcline');
              p = line.to + 1;
            }
            out.push(
              Decoration.widget({
                widget: new MicroPreviewWidget(body, lang, from),
                block: true,
                side: 1,
              }).range(to),
            );
          }
          return false;
        }

        if (!touches(from, to)) {
          out.push(
            Decoration.replace({
              widget: new CodeBlockWidget(body, lang, from, false, frozen, false),
              block: true,
            }).range(from, to),
          );
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

      // ── Steady-State Visual Tables ─────────────────────────────
      if (name === 'Table') {
        excludedInline.push([from, to]);
        const rawTable = doc.sliceString(from, to);
        const isEditingSrc = !frozen && editingBlockFrom === from;
        if (!isEditingSrc) {
          out.push(
            Decoration.replace({
              widget: new VisualTableWidget(rawTable, from, to, frozen, openBlockSourceEditor),
              block: true,
            }).range(from, to),
          );
        } else {
          for (let p = from; p <= to; ) {
            const line = doc.lineAt(p);
            lineClass(line.from, 'aster-lp-codeline aster-lp-micro-srcline');
            p = line.to + 1;
          }
          out.push(
            Decoration.widget({
              widget: new MicroTablePreviewWidget(rawTable, from),
              block: true,
              side: 1,
            }).range(to),
          );
        }
        return false;
      }

      // ── Quotes & GitHub Callouts (> [!NOTE] etc.) ──────────────
      if (name === 'Blockquote') {
        const firstLine = doc.lineAt(from);
        const calloutMatch = firstLine.text.match(/^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+(.*))?$/i);
        if (calloutMatch) {
          const kind = calloutMatch[1].toLowerCase();
          const customTitle = calloutMatch[2]?.trim() ?? '';
          const lastLineNum = doc.lineAt(to).number;
          for (let n = firstLine.number; n <= lastLineNum; n++) {
            const l = doc.line(n);
            const posCls =
              n === firstLine.number && n === lastLineNum
                ? 'is-first is-last'
                : n === firstLine.number
                  ? 'is-first'
                  : n === lastLineNum
                    ? 'is-last'
                    : '';
            lineClass(l.from, `aster-lp-callout-line aster-lp-callout-${kind} ${posCls}`.trim());
          }
          if (!lineTouched(firstLine.from)) {
            calloutHeaderReplacedLines.add(firstLine.number);
            excludedInline.push([firstLine.from, firstLine.to]);
            out.push(
              Decoration.replace({
                widget: new CalloutHeaderWidget(kind, customTitle, firstLine.from),
              }).range(firstLine.from, firstLine.to),
            );
          }
          return true;
        }

        for (let p = from; p <= to; ) {
          const line = doc.lineAt(p);
          lineClass(line.from, 'aster-lp-quote-line');
          p = line.to + 1;
        }
        mark(from, to, 'aster-lp-quote');
        return true;
      }
      if (name === 'QuoteMark') {
        const lineNum = doc.lineAt(from).number;
        if (calloutHeaderReplacedLines.has(lineNum)) return false;
        if (!lineTouched(from)) hideWithSpace(node);
        return false;
      }

      // ── Lists ──────────────────────────────────────────────────
      if (name === 'ListMark') {
        if (lineTouched(from)) return false;
        const item = node.parent;
        if (item?.getChild('Task')) {
          hideWithSpace(node);
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
      if (name === 'InlineCode' || name === 'HTMLTag') {
        excludedInline.push([from, to]);
      }

      if (name in INLINE_STYLE) {
        mark(from, to, INLINE_STYLE[name]);
        if (!touches(from, to)) {
          for (let c = node.firstChild; c; c = c.nextSibling) {
            if (INLINE_MARKS.has(c.name)) hide(c.from, c.to);
          }
        }
        return true;
      }

      if (name === 'Link' || name === 'LinkReference') {
        if (doc.sliceString(from, from + 2) === '[^') return false;
        excludedInline.push([from, to]);
        if (name === 'LinkReference') return false;
        const marks = node.getChildren('LinkMark');
        const url = node.getChild('URL');
        const href = url ? doc.sliceString(url.from, url.to).trim() : '';
        const attrs = href ? { 'data-href': href } : undefined;
        if (marks.length >= 2) {
          mark(marks[0].to, marks[1].from, 'aster-lp-link', attrs);
          if (!touches(from, to)) {
            hide(marks[0].from, marks[0].to);
            hide(marks[1].from, to);
          }
        } else if (url) {
          mark(url.from, url.to, 'aster-lp-link', attrs);
        }
        return false;
      }

      if (name === 'Image') {
        excludedInline.push([from, to]);
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
        excludedInline.push([from, to]);
        const p = node.parent?.name;
        if (p !== 'Link' && p !== 'Image') {
          const raw = doc.sliceString(from, to).replace(/^<|>$/g, '').trim();
          mark(from, to, 'aster-lp-link', raw ? { 'data-href': raw } : undefined);
        }
        return false;
      }

      return true;
    },
  });

  // 4. Scan prose lines for inline `$...$` math, `==highlight==`, and `[^id]` footnotes.
  excludedInline.sort((a, b) => a[0] - b[0]);
  const overlapsExcluded = (from: number, to: number) =>
    excludedInline.some(([ef, et]) => from < et && to > ef);

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text || overlapsExcluded(line.from, line.from + 1) && excludedInline.some(([ef, et]) => line.from >= ef && line.to <= et)) {
      continue;
    }

    const text = line.text;
    let scanStart = 0;

    // Footnote definition at start of line: `[^1]: Explanation`
    const fnDef = text.match(/^\[\^([^\]]+)\]:(\s*)/);
    if (fnDef && !overlapsExcluded(line.from, line.from + fnDef[0].length)) {
      lineClass(line.from, 'aster-lp-footnote-def');
      const defEnd = line.from + fnDef[0].length;
      if (!lineTouched(line.from)) {
        out.push(
          Decoration.replace({
            widget: new FootnoteDefWidget(fnDef[1], line.from),
          }).range(line.from, defEnd),
        );
      } else {
        mark(line.from, defEnd, 'aster-lp-footnote-label');
      }
      scanStart = fnDef[0].length;
    }

    let i = scanStart;
    while (i < text.length) {
      const abs = line.from + i;
      if (overlapsExcluded(abs, abs + 1)) {
        i++;
        continue;
      }
      if (text[i] === '\\') {
        i += 2;
        continue;
      }

      // Highlight: `==text==`
      if (text[i] === '=' && text[i + 1] === '=' && text[i + 2] !== '=') {
        let close = i + 2;
        while (close + 1 < text.length) {
          if (text[close] === '\\') { close += 2; continue; }
          if (text[close] === '=' && text[close + 1] === '=' && text[close + 2] !== '=') break;
          close++;
        }
        if (close + 1 < text.length && close > i + 2) {
          const mFrom = line.from + i;
          const mTo = line.from + close + 2;
          if (!overlapsExcluded(mFrom, mTo)) {
            mark(mFrom, mTo, 'aster-lp-highlight');
            if (!touches(mFrom, mTo)) {
              hide(mFrom, mFrom + 2);
              hide(mTo - 2, mTo);
            }
            i = close + 2;
            continue;
          }
        }
      }

      // Inline Math: `$x^2$` (strict Pandoc/GFM rules: no space right inside `$`, closing `$` not followed by digit)
      if (
        text[i] === '$' &&
        text[i + 1] !== '$' &&
        text[i + 1] !== ' ' &&
        text[i + 1] !== '\t' &&
        (i === 0 || text[i - 1] !== '$')
      ) {
        let close = i + 1;
        let found = -1;
        while (close < text.length) {
          if (text[close] === '\\') { close += 2; continue; }
          if (text[close] === '$') {
            if (
              text[close - 1] !== ' ' &&
              text[close - 1] !== '\t' &&
              text[close + 1] !== '$' &&
              !/\d/.test(text[close + 1] ?? '')
            ) {
              found = close;
            }
            // Any unescaped `$` terminates the candidate (prevents `$100 ... $200 ... $x$` runaway).
            break;
          }
          close++;
        }
        if (found > i + 1 || (found === i + 2 && text[i + 1] !== '$')) {
          const mFrom = line.from + i;
          const mTo = line.from + found + 1;
          const tex = text.slice(i + 1, found);
          if (tex && !overlapsExcluded(mFrom, mTo)) {
            if (!touches(mFrom, mTo)) {
              out.push(
                Decoration.replace({
                  widget: new InlineMathWidget(tex, mFrom, frozen),
                }).range(mFrom, mTo),
              );
            } else {
              mark(mFrom, mTo, 'aster-lp-math-src');
            }
            i = found + 1;
            continue;
          }
        }
      }

      // Footnote reference: `[^id]` (not followed by `:`)
      if (text[i] === '[' && text[i + 1] === '^') {
        const close = text.indexOf(']', i + 2);
        if (close > i + 2 && text[close + 1] !== ':') {
          const fnId = text.slice(i + 2, close);
          if (!/\s/.test(fnId)) {
            const mFrom = line.from + i;
            const mTo = line.from + close + 1;
            if (!overlapsExcluded(mFrom, mTo)) {
              if (!touches(mFrom, mTo)) {
                out.push(
                  Decoration.replace({
                    widget: new FootnoteRefWidget(fnId, mFrom, frozen),
                  }).range(mFrom, mTo),
                );
              } else {
                mark(mFrom, mTo, 'aster-lp-footnote-label');
              }
              i = close + 1;
              continue;
            }
          }
        }
      }

      i++;
    }
  }

  return Decoration.set(out, true);
}

// ── Widgets ──────────────────────────────────────────────────

class FrontmatterWidget extends WidgetType {
  constructor(readonly entries: [string, string][], readonly pos: number) { super(); }
  eq(o: FrontmatterWidget) {
    return (
      o.pos === this.pos &&
      o.entries.length === this.entries.length &&
      o.entries.every(([k, v], idx) => o.entries[idx][0] === k && o.entries[idx][1] === v)
    );
  }
  toDOM(view: EditorView) {
    const card = document.createElement('div');
    card.className = 'aster-lp-frontmatter';
    if (this.entries.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'aster-lp-fm-badge';
      empty.textContent = 'YAML Frontmatter';
      card.appendChild(empty);
    } else {
      for (const [key, val] of this.entries) {
        const item = document.createElement('span');
        item.className = 'aster-lp-fm-item';
        const k = document.createElement('span');
        k.className = 'aster-lp-fm-key';
        k.textContent = key;
        const v = document.createElement('span');
        v.className = 'aster-lp-fm-val';
        v.textContent = val || '—';
        item.append(k, v);
        card.appendChild(item);
      }
    }
    card.addEventListener('mousedown', (e) => {
      if (view.state.readOnly || view.state.facet(freezeMarkupFacet)) return;
      e.preventDefault();
      const targetLine = view.state.doc.lines >= 2 ? view.state.doc.line(2).from : 0;
      view.dispatch({ selection: EditorSelection.cursor(targetLine) });
      view.focus();
    });
    return card;
  }
}

class CalloutHeaderWidget extends WidgetType {
  constructor(readonly kind: string, readonly title: string, readonly pos: number) { super(); }
  eq(o: CalloutHeaderWidget) { return o.kind === this.kind && o.title === this.title && o.pos === this.pos; }
  toDOM(view: EditorView) {
    const meta = CALLOUT_LABELS[this.kind] ?? CALLOUT_LABELS.note;
    const el = document.createElement('span');
    el.className = `aster-lp-callout-title aster-lp-callout-${this.kind}`;
    const icon = document.createElement('span');
    icon.className = 'aster-lp-callout-icon';
    icon.textContent = meta.icon;
    const text = document.createElement('span');
    text.textContent = this.title || meta.label;
    el.append(icon, text);
    el.addEventListener('mousedown', (e) => {
      if (view.state.readOnly || view.state.facet(freezeMarkupFacet)) return;
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.pos + 2) });
      view.focus();
    });
    return el;
  }
}

class FootnoteRefWidget extends WidgetType {
  constructor(readonly id: string, readonly pos: number, readonly frozen: boolean) { super(); }
  eq(o: FootnoteRefWidget) { return o.id === this.id && o.pos === this.pos && o.frozen === this.frozen; }
  toDOM(view: EditorView) {
    const sup = document.createElement('sup');
    sup.className = 'aster-lp-fnref';
    sup.textContent = `[${this.id}]`;
    sup.dataset.fnRef = this.id;
    sup.addEventListener('mousedown', (e) => {
      if (this.frozen || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        jumpToFootnoteDef(view, this.id);
        return;
      }
      if (view.state.readOnly) return;
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.pos + 2) });
      view.focus();
    });
    return sup;
  }
}

class FootnoteDefWidget extends WidgetType {
  constructor(readonly id: string, readonly pos: number) { super(); }
  eq(o: FootnoteDefWidget) { return o.id === this.id && o.pos === this.pos; }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'aster-lp-fndef-badge';
    span.textContent = `[${this.id}]`;
    span.dataset.fnDef = this.id;
    span.addEventListener('mousedown', (e) => {
      if (view.state.readOnly || view.state.facet(freezeMarkupFacet)) return;
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.pos + 2) });
      view.focus();
    });
    return span;
  }
}

function jumpToFootnoteDef(view: EditorView, id: string) {
  const doc = view.state.doc;
  const prefix = `[^${id}]:`;
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    if (l.text.startsWith(prefix)) {
      view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      return;
    }
  }
}

class InlineMathWidget extends WidgetType {
  readonly gen = renderGeneration;
  constructor(readonly tex: string, readonly pos: number, readonly frozen: boolean) { super(); }
  eq(o: InlineMathWidget) {
    return o.tex === this.tex && o.pos === this.pos && o.frozen === this.frozen && o.gen === this.gen;
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'aster-lp-math-inline';
    const key = `${themeGeneration}\u0000math-inline\u0000${this.tex}`;
    const cached = renderCache.get(key);
    if (cached !== undefined) {
      span.innerHTML = cached;
    } else {
      span.textContent = this.tex;
      const rendered = codeRenderer ? codeRenderer('math-inline', this.tex) : null;
      if (rendered) {
        rendered.then(
          (html) => {
            if (html != null) {
              if (renderCache.size >= RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value!);
              renderCache.set(key, html);
              span.innerHTML = html;
              view.requestMeasure();
            }
          },
          () => { /* keep fallback TeX text */ },
        );
      }
    }
    span.addEventListener('mousedown', (e) => {
      if (this.frozen || view.state.readOnly) return;
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.pos + 1) });
      view.focus();
    });
    return span;
  }
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
const RENDER_CACHE_MAX = 250;
let renderGeneration = 0;
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

function makeCopyButton(body: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'aster-lp-copy-btn';
  btn.textContent = 'Copy';
  btn.setAttribute('aria-label', 'Copy code');
  let resetTimer: number | undefined;
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard?.writeText(body).then(() => {
      btn.textContent = '✓';
      btn.classList.add('is-copied');
      clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('is-copied');
      }, 1400);
    }).catch(() => {});
  });
  return btn;
}

function plainCodeBlock(body: string, lang: string, parser: import('@lezer/common').Parser | null = null): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'aster-lp-codeblock';
  const actions = document.createElement('div');
  actions.className = 'aster-lp-code-actions';
  if (lang) {
    const badge = document.createElement('span');
    badge.className = 'aster-lp-codelang';
    badge.textContent = lang;
    actions.appendChild(badge);
  }
  actions.appendChild(makeCopyButton(body));
  pre.appendChild(actions);

  if (parser) pre.appendChild(highlightedCode(body, parser));
  else {
    const code = document.createElement('code');
    code.textContent = body;
    pre.appendChild(code);
  }
  return pre;
}

function attachDiagramToolbar(wrap: HTMLElement, view: EditorView, body: string, pos: number, frozen: boolean) {
  const bar = document.createElement('div');
  bar.className = 'aster-lp-diagram-bar';
  if (!frozen && !view.state.readOnly) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'aster-lp-edit-btn';
    editBtn.textContent = '编辑源码';
    editBtn.setAttribute('aria-label', 'Edit source');
    editBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBlockSourceEditor(view, pos);
    });
    bar.appendChild(editBtn);

    wrap.addEventListener('dblclick', (e) => {
      if (view.state.readOnly || view.state.facet(freezeMarkupFacet)) return;
      e.preventDefault();
      e.stopPropagation();
      openBlockSourceEditor(view, pos);
    });
  }
  bar.appendChild(makeCopyButton(body));
  wrap.appendChild(bar);
}

class CodeBlockWidget extends WidgetType {
  readonly gen = renderGeneration;
  constructor(
    readonly body: string,
    readonly lang: string,
    readonly pos: number,
    readonly isSteady: boolean,
    readonly frozen: boolean,
    readonly selected: boolean,
  ) {
    super();
  }
  toDOM(view: EditorView) {
    const key = `${themeGeneration}\u0000${this.lang}\u0000${this.body}`;
    const wrap = document.createElement('div');
    wrap.className = `aster-lp-rendered${this.selected ? ' is-selected' : ''}`;

    const setDiagramContent = (html: string) => {
      const content = document.createElement('div');
      content.className = 'aster-lp-rendered-body';
      content.innerHTML = html;
      wrap.replaceChildren(content);
      if (this.isSteady) attachDiagramToolbar(wrap, view, this.body, this.pos, this.frozen);
    };

    const cached = renderCache.get(key);
    if (cached !== undefined) {
      setDiagramContent(cached);
      return wrap;
    }

    const plugin = this.lang && codeRenderer ? codeRenderer(this.lang, this.body) : null;
    const syntax = this.lang ? parserFor(this.lang) : Promise.resolve(null);
    wrap.classList.add('is-pending');
    wrap.appendChild(plainCodeBlock(this.body, this.lang));
    if (this.isSteady) attachDiagramToolbar(wrap, view, this.body, this.pos, this.frozen);

    Promise.all([plugin ?? Promise.resolve(null), syntax]).then(
      ([html, parser]) => {
        wrap.classList.remove('is-pending');
        if (html != null) {
          if (renderCache.size >= RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value!);
          renderCache.set(key, html);
          setDiagramContent(html);
        } else if (parser) {
          wrap.replaceChildren(plainCodeBlock(this.body, this.lang, parser));
          if (this.isSteady) attachDiagramToolbar(wrap, view, this.body, this.pos, this.frozen);
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
  eq(o: CodeBlockWidget) {
    return (
      o.body === this.body &&
      o.lang === this.lang &&
      o.pos === this.pos &&
      o.isSteady === this.isSteady &&
      o.frozen === this.frozen &&
      o.selected === this.selected &&
      o.gen === this.gen
    );
  }
}

/** Stacked live-preview card displayed directly under the source lines while editing a diagram/math block. */
class MicroPreviewWidget extends WidgetType {
  readonly gen = renderGeneration;
  constructor(readonly body: string, readonly lang: string, readonly blockFrom: number) { super(); }
  eq(o: MicroPreviewWidget) {
    return o.body === this.body && o.lang === this.lang && o.blockFrom === this.blockFrom && o.gen === this.gen;
  }
  toDOM(view: EditorView) {
    const panel = document.createElement('div');
    panel.className = 'aster-lp-micro-panel';

    const head = document.createElement('div');
    head.className = 'aster-lp-micro-head';
    const label = document.createElement('span');
    label.className = 'aster-lp-micro-label';
    label.textContent = `${this.lang.toUpperCase()} PREVIEW`;
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'aster-lp-done-btn';
    done.textContent = '完成 (Esc)';
    done.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    done.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeBlockSourceEditor(view);
    });
    head.append(label, done);

    const preview = document.createElement('div');
    preview.className = 'aster-lp-micro-preview';

    const key = `${themeGeneration}\u0000${this.lang}\u0000${this.body}`;
    const cached = renderCache.get(key);
    if (cached !== undefined) {
      preview.innerHTML = cached;
    } else {
      const plugin = codeRenderer ? codeRenderer(this.lang, this.body) : null;
      if (plugin) {
        plugin.then(
          (html) => {
            if (html != null) {
              renderCache.set(key, html);
              preview.innerHTML = html;
            } else {
              preview.textContent = this.body;
            }
            view.requestMeasure();
          },
          (err) => {
            preview.className = 'aster-lp-micro-preview aster-lp-render-error';
            preview.textContent = `${this.lang}: ${err instanceof Error ? err.message : String(err)}`;
            view.requestMeasure();
          },
        );
      } else {
        preview.textContent = this.body;
      }
    }

    panel.append(head, preview);
    return panel;
  }
}

class MicroTablePreviewWidget extends WidgetType {
  constructor(readonly src: string, readonly blockFrom: number) { super(); }
  eq(o: MicroTablePreviewWidget) { return o.src === this.src && o.blockFrom === this.blockFrom; }
  toDOM(view: EditorView) {
    const panel = document.createElement('div');
    panel.className = 'aster-lp-micro-panel';

    const head = document.createElement('div');
    head.className = 'aster-lp-micro-head';
    const label = document.createElement('span');
    label.className = 'aster-lp-micro-label';
    label.textContent = 'TABLE PREVIEW';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'aster-lp-done-btn';
    done.textContent = '完成 (Esc)';
    done.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    done.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeBlockSourceEditor(view);
    });
    head.append(label, done);

    const preview = new VisualTableWidget(this.src, this.blockFrom, this.blockFrom + this.src.length, true).toDOM(view);
    panel.append(head, preview);
    return panel;
  }
}

const refreshEffect = StateEffect.define<null>();

export function refreshCodeBlocks(view: EditorView, opts: { clearCache?: boolean } = {}): void {
  if (opts.clearCache) {
    renderCache.clear();
    themeGeneration++;
  }
  renderGeneration++;
  view.dispatch({ effects: refreshEffect.of(null) });
}

const livePreviewField = StateField.define<DecorationSet>({
  create: (s) => build(s),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(refreshEffect) || e.is(setEditingBlockEffect)) ||
      tr.state.facet(freezeMarkupFacet) !== tr.startState.facet(freezeMarkupFacet) ||
      tr.state.field(editingBlockField, false) !== tr.startState.field(editingBlockField, false) ||
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

class HeadingGutter extends GutterMarker {
  elementClass = 'aster-gutter-heading';
  eq() { return true; }
}
const HEADING_GUTTER = new HeadingGutter();

function headingGutterClasses(set: DecorationSet) {
  const positions = new Set<number>();
  set.between(0, 1e9, (from, _to, deco) => {
    const spec = deco.spec as { class?: string };
    if (!spec.class || !spec.class.includes('aster-lp-heading')) return;
    positions.add(from);
  });
  return RangeSet.of([...positions].map((from) => HEADING_GUTTER.range(from)), true);
}

const linkClickHandler = EditorView.domEventHandlers({
  click(e, view) {
    if (e.button !== 0 || !linkOpener) return false;
    const target = e.target as HTMLElement | null;
    const linkEl = target?.closest?.('[data-href], .aster-lp-table a') as HTMLElement | null;
    if (!linkEl) return false;
    const href = linkEl.getAttribute('data-href') ?? linkEl.getAttribute('href');
    if (!href) return false;
    if (view.state.facet(freezeMarkupFacet) || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      linkOpener(href);
      return true;
    }
    return false;
  },
});

const steadyBlockKeymap = keymap.of([
  { key: 'Escape', run: closeBlockSourceEditor },
]);

export interface LivePreviewOptions {
  resolveImage?: (src: string) => string;
  renderCodeBlock?: CodeBlockRenderer;
  freezeMarkup?: boolean;
  onOpenLink?: (href: string) => void;
}

export function livePreviewExtension(opts: LivePreviewOptions = {}): Extension {
  if ((opts.renderCodeBlock ?? null) !== codeRenderer) {
    renderCache.clear();
  }
  imageResolver = opts.resolveImage ?? null;
  codeRenderer = opts.renderCodeBlock ?? null;
  linkOpener = opts.onOpenLink ?? null;
  return [
    freezeMarkupFacet.of(!!opts.freezeMarkup),
    editingBlockField,
    steadyBlockKeymap,
    livePreviewField,
    linkClickHandler,
  ];
}

let imageResolver: ((src: string) => string) | null = null;
let linkOpener: ((href: string) => void) | null = null;

/** Exposed for tests. */
export function __computeDecorations(target: EditorView | EditorState, freezeMarkup = false): DecorationSet {
  return build(target instanceof EditorView ? target.state : target, freezeMarkup);
}
