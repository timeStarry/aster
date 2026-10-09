// PDF Export plugin — uses browser print dialog with print-optimised CSS.
// The plugin injects a hidden iframe with rendered HTML, then calls window.print().

(function () {
  const PRINT_CSS = `
    @page { margin: 20mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12pt;
      line-height: 1.7;
      color: #111;
      max-width: 100%;
    }
    pre, code {
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
      font-size: 10pt;
      background: #f6f8fa;
      border-radius: 3px;
      padding: 2px 4px;
    }
    pre { padding: 12px; overflow: visible; white-space: pre-wrap; }
    blockquote {
      border-left: 3px solid #ccc;
      margin: 0;
      padding-left: 1em;
      color: #555;
    }
    img { max-width: 100%; }
    h1, h2, h3, h4 { page-break-after: avoid; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ccc; padding: 6px 10px; }
    a { color: #0969da; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  // Minimal Markdown → HTML (avoids pulling in a parser at print time;
  // the existing reading-mode pipeline already produced rendered HTML if
  // available, so we take that first).
  function markdownToHtml(md) {
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^#{6}\s(.+)$/gm, '<h6>$1</h6>')
      .replace(/^#{5}\s(.+)$/gm, '<h5>$1</h5>')
      .replace(/^#{4}\s(.+)$/gm, '<h4>$1</h4>')
      .replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>')
      .replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#{1}\s(.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^---+$/gm, '<hr>')
      .replace(/\n\n/g, '</p><p>');
    return `<p>${html}</p>`;
  }

  function getDocumentHtml() {
    // Prefer the reading-mode container if it is currently visible and populated.
    const readingPane = document.querySelector('.aster-reading-pane, [data-aster-reading]');
    if (readingPane && readingPane.innerHTML.trim().length > 50) {
      return readingPane.innerHTML;
    }
    // Fall back: grab CodeMirror editor content.
    const cmContent = document.querySelector('.cm-content');
    if (cmContent) {
      return markdownToHtml(cmContent.innerText || '');
    }
    return '<p>No content found.</p>';
  }

  function printDocument(explicitContent) {
    const bodyHtml = explicitContent
      ? markdownToHtml(explicitContent)
      : getDocumentHtml();

    const title = document.title || 'Aster Document';

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${PRINT_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`);
    doc.close();

    iframe.contentWindow.addEventListener('afterprint', () => {
      document.body.removeChild(iframe);
    });

    // Small delay so the iframe can finish layout before the print dialog opens.
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 120);

    return { status: 'printing' };
  }

  window.__aster.commands.register('pdf-export.print', async (params) => {
    return printDocument(params.content || null);
  });

  // Also wire up a keyboard shortcut: Cmd/Ctrl + Shift + P
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
      e.preventDefault();
      printDocument(null);
    }
  }, { capture: true });
})();
