import { describe, it, expect } from 'vitest';
import { createDefaultPipeline } from '../src/pipeline';
import { extractToc } from '../src/toc';

describe('renderer pipeline', () => {
  it('renders heading', () => {
    const p = createDefaultPipeline();
    expect(p.render('# Hello')).toContain('<h1>');
  });

  it('renders code block with highlight class', () => {
    const p = createDefaultPipeline();
    const out = p.render('```js\nconsole.log(1)\n```');
    expect(out).toContain('hljs');
  });

  it('escapes HTML in plain content', () => {
    const p = createDefaultPipeline();
    const out = p.render('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
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
