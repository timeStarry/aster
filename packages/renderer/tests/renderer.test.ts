import { describe, it, expect } from 'vitest';
import { createDefaultPipeline, buildStandaloneHtml } from '../src/pipeline';
import { extractToc } from '../src/toc';

describe('renderer pipeline', () => {
  it('renders heading with anchor slug', () => {
    const p = createDefaultPipeline();
    expect(p.render('# Hello World')).toContain('<h1 id="hello-world">Hello World</h1>');
  });

  it('renders code block with Lezer syntax highlighting', async () => {
    const p = createDefaultPipeline();
    const out = await p.renderAsync('```js\nconst answer = 42;\n```');
    expect(out).toContain('hljs');
    expect(out).toContain('tok-keyword');
    expect(out).toContain('tok-number');
  });

  it('escapes HTML in plain content', () => {
    const p = createDefaultPipeline();
    const out = p.render('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
  });

  it('strips frontmatter and renders highlights, callouts, footnotes, math, and mermaid', async () => {
    const p = createDefaultPipeline();
    const md = [
      '---',
      'title: Secret Frontmatter',
      '---',
      '',
      'Use ==highlighted== text[^1] with $E=mc^2$ and $100 to $200.',
      '',
      '> [!TIP] Pro Tip',
      '> Zero-jank writing.',
      '',
      '$$',
      'a^2 + b^2 = c^2',
      '$$',
      '',
      '[^1]: Footnote body.',
    ].join('\n');

    const html = await p.renderAsync(md, {
      renderCodeBlock: (lang, code) => `<span class="mock-${lang}">${code}</span>`,
    });

    expect(html).not.toContain('Secret Frontmatter');
    expect(html).toContain('<mark>highlighted</mark>');
    expect(html).toContain('aster-callout-tip');
    expect(html).toContain('Pro Tip');
    expect(html).toContain('mock-math-inline');
    expect(html).toContain('$100 to $200');
    expect(html).toContain('mock-math');
    expect(html).toContain('id="fn-1"');
    expect(html).toContain('Footnote body.');

    const doc = buildStandaloneHtml(html, { title: 'Spec', theme: 'paper' });
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).toContain('break-inside: avoid');
  });
});

describe('toc extraction', () => {
  it('extracts headings from rendered html', () => {
    const p = createDefaultPipeline();
    const html = p.render('# A\n## B\n### C\n');
    const toc = extractToc(html);
    expect(toc).toHaveLength(3);
    expect(toc[0].level).toBe(1);
    expect(toc[0].text).toBe('A');
    expect(toc[1].level).toBe(2);
    expect(toc[2].level).toBe(3);
  });
});
