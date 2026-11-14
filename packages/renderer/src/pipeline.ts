import MarkdownIt from 'markdown-it';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Parser } from '@lezer/common';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';

export interface RenderOptions {
  /** Optional async/sync block renderer for `math`, `math-inline`, `mermaid`, etc. */
  renderCodeBlock?: (lang: string, code: string) => Promise<string | null> | string | null;
  /** Optional image URL resolver (e.g. converting relative `assets/...` paths). */
  resolveImage?: (src: string) => string;
}

export interface StandaloneHtmlOptions {
  title?: string;
  theme?: 'paper' | 'light' | 'dark' | 'midnight';
  extraHeadHtml?: string;
}

export interface RenderPipeline {
  render(md: string, opts?: Pick<RenderOptions, 'resolveImage'>): string;
  renderAsync(md: string, opts?: RenderOptions): Promise<string>;
}

const lezerHighlighter = tagHighlighter([
  { tag: t.keyword, class: 'tok-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], class: 'tok-string' },
  { tag: [t.number, t.bool, t.null, t.atom, t.self], class: 'tok-number' },
  { tag: t.comment, class: 'tok-comment' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], class: 'tok-fn' },
  { tag: [t.typeName, t.className, t.namespace, t.attributeName], class: 'tok-type' },
  { tag: [t.tagName, t.special(t.variableName)], class: 'tok-tag' },
  { tag: [t.processingInstruction, t.meta], class: 'tok-meta' },
]);

const parserCache = new Map<string, Parser>();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function highlightWithLezer(code: string, lang: string): string {
  const key = lang.trim().toLowerCase();
  if (!key) return escapeHtml(code);

  let parser = parserCache.get(key);
  if (!parser) {
    const desc = LanguageDescription.matchLanguageName(languages, key, true);
    if (desc?.support) {
      parser = desc.support.language.parser;
      parserCache.set(key, parser);
    }
  }
  if (!parser) return escapeHtml(code);

  const tree = parser.parse(code);
  let out = '';
  let pos = 0;
  highlightTree(tree, lezerHighlighter, (from, to, classes) => {
    if (from > pos) out += escapeHtml(code.slice(pos, from));
    out += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
    pos = to;
  });
  if (pos < code.length) out += escapeHtml(code.slice(pos));
  return out;
}

async function preloadCodeParsers(md: string): Promise<void> {
  const seen = new Set<string>();
  const fenceRe = /^ {0,3}(?:```+|~~~+)\s*([a-zA-Z0-9_+#.-]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(md)) !== null) {
    const lang = m[1].toLowerCase();
    if (lang === 'math' || lang === 'mermaid' || parserCache.has(lang) || seen.has(lang)) continue;
    seen.add(lang);
    const desc = LanguageDescription.matchLanguageName(languages, lang, true);
    if (desc) {
      try {
        const support = await desc.load();
        parserCache.set(lang, support.language.parser);
      } catch {
        /* ignore missing grammar */
      }
    }
  }
}

/** Strip YAML frontmatter at byte 0 (`---\n...\n---`) so exported prose starts cleanly. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const m = md.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  return m ? md.slice(m[0].length) : md;
}

interface ExtractedBlock {
  placeholder: string;
  kind: 'math' | 'mermaid';
  code: string;
}

/**
 * Extract `$$...$$` display math blocks before markdown-it runs so inner `_` / `*`
 * characters are never mangled as Markdown emphasis.
 */
function preprocessDisplayMath(
  md: string,
  blocks: ExtractedBlock[],
): string {
  // Multi-line `$$\n...\n$$` and single-line `$$...$$` on its own line
  return md.replace(
    /^ {0,3}\$\$[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}\$\$[ \t]*$|^ {0,3}\$\$([^\n$]+)\$\$[ \t]*$/gm,
    (_full, multi: string | undefined, single: string | undefined) => {
      const code = (multi ?? single ?? '').trim();
      const id = `ASTERBLOCK${blocks.length}END`;
      const placeholder = `\n\n<div data-aster-placeholder="${id}"></div>\n\n`;
      blocks.push({ placeholder: id, kind: 'math', code });
      return placeholder;
    },
  );
}

interface FootnoteDef {
  id: string;
  index: number;
  body: string;
}

function extractFootnoteDefs(md: string): { cleaned: string; defs: Map<string, FootnoteDef> } {
  const defs = new Map<string, FootnoteDef>();
  let idx = 1;
  const cleaned = md.replace(/^\[\^([^\]]+)\]:[ \t]*(.+)$/gm, (_full, rawId: string, body: string) => {
    const id = rawId.trim();
    if (!defs.has(id)) {
      defs.set(id, { id, index: idx++, body: body.trim() });
    }
    return '';
  });
  return { cleaned, defs };
}

/** Add `==highlight==`, Pandoc inline `$...$` math, and `[^id]` footnote refs to markdown-it inline ruler. */
function installInlineExtensions(
  mdi: MarkdownIt,
  getFootnotes: () => Map<string, FootnoteDef>,
  inlineMathTokens: ExtractedBlock[],
) {
  // ==highlight==
  mdi.inline.ruler.before('emphasis', 'aster_highlight', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src.charCodeAt(pos) !== 0x3d /* = */ || src.charCodeAt(pos + 1) !== 0x3d) return false;
    const close = src.indexOf('==', pos + 2);
    if (close <= pos + 2) return false;
    const inner = src.slice(pos + 2, close);
    if (!inner.trim() || inner.includes('\n')) return false;
    if (!silent) {
      const openTok = state.push('mark_open', 'mark', 1);
      openTok.markup = '==';
      const textTok = state.push('text', '', 0);
      textTok.content = inner;
      const closeTok = state.push('mark_close', 'mark', -1);
      closeTok.markup = '==';
    }
    state.pos = close + 2;
    return true;
  });

  // Pandoc-strict inline `$...$` math (ignores currency like `$100 and $200`)
  mdi.inline.ruler.before('escape', 'aster_inline_math', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src.charCodeAt(pos) !== 0x24 /* $ */) return false;
    if (src.charCodeAt(pos + 1) === 0x24) return false; // `$$`
    if (pos > 0 && src.charCodeAt(pos - 1) === 0x5c /* \ */) return false;
    const nextCh = src[pos + 1];
    if (!nextCh || /\s/.test(nextCh)) return false;

    let close = -1;
    for (let j = pos + 1; j < src.length; j++) {
      if (src.charCodeAt(j) === 0x5c) {
        j++;
        continue;
      }
      if (src.charCodeAt(j) === 0x24) {
        const prevCh = src[j - 1];
        const afterCh = src[j + 1] ?? '';
        if (!/\s/.test(prevCh) && !/\d/.test(afterCh)) {
          close = j;
        }
        break;
      }
    }
    if (close === -1) return false;
    const expr = src.slice(pos + 1, close);
    if (!expr) return false;

    if (!silent) {
      const id = `ASTERINLINEMATH${inlineMathTokens.length}END`;
      inlineMathTokens.push({ placeholder: id, kind: 'math', code: expr });
      const tok = state.push('aster_inline_math', 'span', 0);
      tok.meta = { id, expr };
    }
    state.pos = close + 1;
    return true;
  });

  mdi.renderer.rules.aster_inline_math = (tokens, idx) => {
    const { id, expr } = tokens[idx].meta as { id: string; expr: string };
    return `<span class="aster-math-inline" data-aster-math="${id}">${escapeHtml(expr)}</span>`;
  };

  // Footnote references `[^id]`
  mdi.inline.ruler.before('link', 'aster_footnote_ref', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5e /* ^ */) return false;
    const close = src.indexOf(']', pos + 2);
    if (close <= pos + 2) return false;
    if (src.charCodeAt(close + 1) === 0x3a /* : */) return false;
    const rawId = src.slice(pos + 2, close).trim();
    if (!rawId || /\s/.test(rawId)) return false;

    if (!silent) {
      const defs = getFootnotes();
      let def = defs.get(rawId);
      if (!def) {
        def = { id: rawId, index: defs.size + 1, body: '' };
      }
      const tok = state.push('aster_fn_ref', 'sup', 0);
      tok.meta = { id: rawId, index: def.index };
    }
    state.pos = close + 1;
    return true;
  });

  mdi.renderer.rules.aster_fn_ref = (tokens, idx) => {
    const { id, index } = tokens[idx].meta as { id: string; index: number };
    const safeId = escapeHtml(slugify(id) || id);
    return `<sup class="aster-fn-ref"><a href="#fn-${safeId}" id="fnref-${safeId}">[${index}]</a></sup>`;
  };
}

const CALLOUT_LABELS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

function transformCalloutBlockquotes(html: string): string {
  return html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\n<]*))?(?:\n|<br\s*\/?>)?([\s\S]*?)<\/blockquote>/gi,
    (_full, rawKind: string, customTitle: string | undefined, rest: string) => {
      const kind = rawKind.toLowerCase();
      const title = (customTitle ?? '').trim() || CALLOUT_LABELS[kind] || rawKind;
      const trimmedRest = rest.trim();
      const bodyHtml = trimmedRest.startsWith('</p>')
        ? trimmedRest.slice(4).trim()
        : trimmedRest
          ? `<p>${trimmedRest}`
          : '';
      return `<div class="aster-callout aster-callout-${kind}"><div class="aster-callout-title">${escapeHtml(title)}</div>${bodyHtml}</div>`;
    },
  );
}

export function createDefaultPipeline(): RenderPipeline {
  let activeFootnotes = new Map<string, FootnoteDef>();
  let activeBlocks: ExtractedBlock[] = [];
  let activeInlineMath: ExtractedBlock[] = [];
  let activeResolveImage: ((src: string) => string) | undefined;

  const mdi = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  // Escape raw HTML from user Markdown UNLESS it is our own `<div data-aster-placeholder="ASTERBLOCK...">`
  mdi.renderer.rules.html_block = (tokens, idx) => {
    const raw = tokens[idx].content;
    if (/^\s*<div data-aster-placeholder="ASTERBLOCK\d+END"><\/div>\s*$/.test(raw)) {
      return raw;
    }
    return `<p>${escapeHtml(raw)}</p>`;
  };
  mdi.renderer.rules.html_inline = (tokens, idx) => escapeHtml(tokens[idx].content);

  // Heading anchor slugs
  mdi.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
    const titleTok = tokens[idx + 1];
    const slug = titleTok?.content ? slugify(titleTok.content) : '';
    if (slug) tokens[idx].attrSet('id', slug);
    return self.renderToken(tokens, idx, options);
  };

  // Image URL resolution
  const defaultImageRule =
    mdi.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  mdi.renderer.rules.image = (tokens, idx, options, env, self) => {
    const src = tokens[idx].attrGet('src');
    if (src && activeResolveImage) {
      tokens[idx].attrSet('src', activeResolveImage(src));
    }
    return defaultImageRule(tokens, idx, options, env, self);
  };

  // Fenced code blocks (`math`, `mermaid`, and Lezer-highlighted code)
  mdi.renderer.rules.fence = (tokens, idx) => {
    const tok = tokens[idx];
    const info = tok.info ? mdi.utils.unescapeAll(tok.info).trim() : '';
    const langName = info.split(/\s+/g)[0]?.toLowerCase() ?? '';
    const rawCode = tok.content;

    if (langName === 'math' || langName === 'mermaid') {
      const id = `ASTERBLOCK${activeBlocks.length}END`;
      activeBlocks.push({
        placeholder: id,
        kind: langName,
        code: rawCode.replace(/\n$/, ''),
      });
      return `<div data-aster-placeholder="${id}"></div>\n`;
    }

    const highlighted = highlightWithLezer(rawCode, langName);
    const langClass = langName ? ` class="language-${escapeHtml(langName)}"` : '';
    return `<pre class="aster-code hljs"><code${langClass}>${highlighted}</code></pre>\n`;
  };

  installInlineExtensions(mdi, () => activeFootnotes, activeInlineMath);

  const renderCore = (md: string, resolveImage?: (src: string) => string) => {
    const stripped = stripFrontmatter(md);
    const blocks: ExtractedBlock[] = [];
    const inlineMath: ExtractedBlock[] = [];
    const withMathPlaceholders = preprocessDisplayMath(stripped, blocks);
    const { cleaned, defs } = extractFootnoteDefs(withMathPlaceholders);

    activeFootnotes = defs;
    activeBlocks = blocks;
    activeInlineMath.length = 0;
    activeResolveImage = resolveImage;

    let html = mdi.render(cleaned);
    inlineMath.push(...activeInlineMath);
    activeResolveImage = undefined;

    html = transformCalloutBlockquotes(html);

    if (defs.size > 0) {
      const items = [...defs.values()]
        .sort((a, b) => a.index - b.index)
        .map((d) => {
          const safeId = escapeHtml(slugify(d.id) || d.id);
          const renderedBody = mdi.renderInline(d.body);
          return `<li id="fn-${safeId}">${renderedBody} <a href="#fnref-${safeId}" class="aster-fn-back">↩</a></li>`;
        })
        .join('\n');
      html += `\n<section class="aster-footnotes"><hr><ol>\n${items}\n</ol></section>\n`;
    }

    return { html, blocks, inlineMath };
  };

  const replaceFallbackBlocks = (
    rawHtml: string,
    blocks: ExtractedBlock[],
  ): string => {
    let out = rawHtml;
    for (const b of blocks) {
      const fallback =
        b.kind === 'math'
          ? `<div class="aster-math-block"><code>${escapeHtml(b.code)}</code></div>`
          : `<pre class="aster-mermaid-fallback"><code>${escapeHtml(b.code)}</code></pre>`;
      out = out.replace(`<div data-aster-placeholder="${b.placeholder}"></div>`, fallback);
    }
    return out;
  };

  return {
    render(md: string, opts?: Pick<RenderOptions, 'resolveImage'>): string {
      const { html, blocks } = renderCore(md, opts?.resolveImage);
      return replaceFallbackBlocks(html, blocks);
    },

    async renderAsync(md: string, opts?: RenderOptions): Promise<string> {
      await preloadCodeParsers(md);
      const { html, blocks, inlineMath } = renderCore(md, opts?.resolveImage);
      let out = html;

      for (const b of blocks) {
        let rendered: string | null = null;
        if (opts?.renderCodeBlock) {
          try {
            rendered = await opts.renderCodeBlock(b.kind, b.code);
          } catch {
            rendered = null;
          }
        }
        const replacement = rendered
          ? `<div class="aster-rendered-block aster-rendered-${b.kind}">${rendered}</div>`
          : b.kind === 'math'
            ? `<div class="aster-math-block"><code>${escapeHtml(b.code)}</code></div>`
            : `<pre class="aster-mermaid-fallback"><code>${escapeHtml(b.code)}</code></pre>`;
        out = out.replace(`<div data-aster-placeholder="${b.placeholder}"></div>`, replacement);
      }

      if (opts?.renderCodeBlock && inlineMath.length > 0) {
        for (const im of inlineMath) {
          let rendered: string | null = null;
          try {
            rendered = await opts.renderCodeBlock('math-inline', im.code);
          } catch {
            rendered = null;
          }
          if (rendered) {
            out = out.replace(
              new RegExp(`<span class="aster-math-inline" data-aster-math="${im.placeholder}">[\\s\\S]*?<\\/span>`),
              `<span class="aster-math-inline">${rendered}</span>`,
            );
          }
        }
      }

      return out;
    },
  };
}

const STANDALONE_THEMES: Record<NonNullable<StandaloneHtmlOptions['theme']>, string> = {
  paper: `--bg:#FCFBF8;--surface:#F4F1EA;--fg:#191C26;--muted:#5D6375;--border:#E5E0D6;--accent:#4250DC;--mark:rgba(245,180,0,0.28);--kw:#7C3AED;--str:#0F766E;--num:#B45309;--fn:#2563EB;--typ:#9333EA;--cmt:#8A90A2;`,
  light: `--bg:#FFFFFF;--surface:#F6F7FA;--fg:#181B24;--muted:#5B6274;--border:#E4E7EE;--accent:#4250DC;--mark:rgba(250,204,21,0.32);--kw:#7C3AED;--str:#0F766E;--num:#B45309;--fn:#2563EB;--typ:#9333EA;--cmt:#8A90A2;`,
  dark: `--bg:#191C26;--surface:#222634;--fg:#E8ECF4;--muted:#9CA3B8;--border:#2F3547;--accent:#7B88FF;--mark:rgba(250,204,21,0.26);--kw:#C084FC;--str:#34D399;--num:#FBBF24;--fn:#60A5FA;--typ:#A78BFA;--cmt:#6B738A;`,
  midnight: `--bg:#090A0F;--surface:#131620;--fg:#EEF1F8;--muted:#9098AE;--border:#232838;--accent:#8390FF;--mark:rgba(250,204,21,0.25);--kw:#C084FC;--str:#34D399;--num:#FBBF24;--fn:#60A5FA;--typ:#A78BFA;--cmt:#6B738A;`,
};

/** Wrap rendered HTML fragment in a self-contained, print-ready Aster HTML5 document. */
export function buildStandaloneHtml(bodyHtml: string, opts: StandaloneHtmlOptions = {}): string {
  const title = escapeHtml(opts.title || 'Aster Document');
  const vars = STANDALONE_THEMES[opts.theme ?? 'paper'] ?? STANDALONE_THEMES.paper;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { ${vars} }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 56px 28px 88px;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI Variable Text", "Microsoft YaHei UI", system-ui, sans-serif;
    font-size: 16px;
    line-height: 1.78;
    -webkit-font-smoothing: antialiased;
  }
  main.aster-export-doc {
    max-width: 760px;
    margin: 0 auto;
  }
  h1, h2, h3, h4, h5, h6 {
    line-height: 1.32;
    letter-spacing: -0.015em;
    margin-top: 1.65em;
    margin-bottom: 0.55em;
    font-weight: 650;
  }
  h1 { font-size: 2em; margin-top: 0; }
  h2 { font-size: 1.5em; padding-bottom: 0.24em; border-bottom: 1px solid var(--border); }
  h3 { font-size: 1.24em; }
  p, ul, ol, table, pre, blockquote, .aster-callout, .aster-rendered-block {
    margin: 0 0 1.08em;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  mark {
    background: var(--mark);
    color: inherit;
    padding: 0.08em 0.24em;
    border-radius: 3px;
  }
  code {
    font-family: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 0.88em;
    background: var(--surface);
    padding: 0.16em 0.38em;
    border-radius: 5px;
  }
  pre.aster-code {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
    overflow-x: auto;
    line-height: 1.58;
  }
  pre.aster-code code {
    background: transparent;
    padding: 0;
    font-size: 0.875em;
  }
  .tok-keyword { color: var(--kw); font-weight: 500; }
  .tok-string { color: var(--str); }
  .tok-number { color: var(--num); }
  .tok-comment { color: var(--cmt); font-style: italic; }
  .tok-fn { color: var(--fn); }
  .tok-type, .tok-tag { color: var(--typ); }
  blockquote {
    border-left: 3px solid var(--border);
    padding: 0.15em 0 0.15em 1.1em;
    color: var(--muted);
  }
  .aster-callout {
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    background: var(--surface);
    border-radius: 8px;
    padding: 12px 16px;
  }
  .aster-callout-tip { border-left-color: #10B981; }
  .aster-callout-important { border-left-color: #8B5CF6; }
  .aster-callout-warning { border-left-color: #F59E0B; }
  .aster-callout-caution { border-left-color: #EF4444; }
  .aster-callout-title {
    font-weight: 650;
    font-size: 0.92em;
    margin-bottom: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95em;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 8px 12px;
    text-align: left;
  }
  th { background: var(--surface); font-weight: 600; }
  img, svg { max-width: 100%; height: auto; border-radius: 6px; }
  hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
  .aster-rendered-math { text-align: center; overflow-x: auto; padding: 8px 0; }
  .aster-rendered-mermaid { text-align: center; overflow-x: auto; padding: 8px 0; }
  .aster-footnotes { font-size: 0.9em; color: var(--muted); margin-top: 2.5em; }
  @page { margin: 18mm; }
  @media print {
    :root { ${STANDALONE_THEMES.light} }
    body { padding: 0; background: #fff; color: #111; font-size: 11.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    main.aster-export-doc { max-width: 100%; }
    h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
    pre, blockquote, .aster-callout, table, .aster-rendered-block, figure, img {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
</style>
${opts.extraHeadHtml ?? ''}
</head>
<body>
<main class="aster-export-doc">
${bodyHtml}
</main>
</body>
</html>`;
}
