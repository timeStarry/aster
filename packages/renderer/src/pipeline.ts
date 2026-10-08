import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

export interface RenderPipeline {
  render(md: string): string;
}

export function createDefaultPipeline(): RenderPipeline {
  const mdi = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight(str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
        } catch (_) { /* fallthrough */ }
      }
      return `<pre class="hljs"><code>${mdi.utils.escapeHtml(str)}</code></pre>`;
    },
  });
  return { render: (md) => mdi.render(md) };
}
