// PDF Export plugin — uses browser print dialog with Aster's unified high-fidelity HTML renderer.
// Injects a hidden print iframe with full KaTeX/Mermaid/Lezer/Callout styling, then invokes print().

(function () {
  const FALLBACK_PRINT_CSS = `
    @page { margin: 18mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
      font-size: 11.5pt;
      line-height: 1.72;
      color: #111;
      max-width: 100%;
      margin: 0;
    }
    pre, code {
      font-family: "SF Mono", "JetBrains Mono", Consolas, monospace;
      font-size: 9.5pt;
      background: #f6f7fa;
      border-radius: 5px;
    }
    pre { padding: 12px 14px; overflow: visible; white-space: pre-wrap; border: 1px solid #e4e7ee; }
    blockquote, .aster-callout {
      border-left: 3px solid #cbd5e1;
      margin: 0 0 1em;
      padding: 6px 14px;
    }
    img, svg { max-width: 100%; height: auto; }
    h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
    pre, blockquote, .aster-callout, table, .aster-rendered-block, figure, img {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
    td, th { border: 1px solid #d0d7de; padding: 6px 10px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  async function buildPrintDocument(explicitContent) {
    const ed = window.__aster && window.__aster.editor;
    if (ed && typeof ed.getStandaloneHtml === 'function') {
      return await ed.getStandaloneHtml(explicitContent || undefined);
    }
    const title = (ed && ed.getTitle()) || document.title || 'Aster Document';
    const bodyHtml = ed && typeof ed.getHtmlAsync === 'function'
      ? await ed.getHtmlAsync()
      : ed
        ? ed.getHtml()
        : '<p>No content found.</p>';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${FALLBACK_PRINT_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`;
  }

  async function printDocument(explicitContent) {
    const fullHtml = await buildPrintDocument(explicitContent);

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(fullHtml);
    doc.close();

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    iframe.contentWindow.addEventListener('afterprint', cleanup);

    // Give images and external font/KaTeX stylesheets in the iframe a brief beat to settle.
    setTimeout(() => {
      if (!iframe.contentWindow) return;
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(cleanup, 60000);
    }, 180);

    return { status: 'printing' };
  }

  window.__aster.commands.register('pdf-export.print', async (params) => {
    return printDocument((params && params.content) || null);
  });
})();
