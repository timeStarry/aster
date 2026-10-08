// Loaded when a mermaid code block is encountered.
// Registers a renderer that replaces the raw <pre> with a rendered SVG.
let mermaid;

async function loadMermaid() {
  if (mermaid) return mermaid;
  try {
    const m = await import('./mermaid.min.js');
    mermaid = m.default ?? m;
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  } catch (e) {
    console.error('[aster.mermaid] failed to load mermaid:', e);
  }
  return mermaid;
}

window.__aster.renderers.register('mermaid', async (source) => {
  const m = await loadMermaid();
  if (!m) return `<pre>${source}</pre>`;
  try {
    const id = 'mermaid-' + Math.random().toString(36).slice(2);
    const { svg } = await m.render(id, source);
    return svg;
  } catch (e) {
    return `<pre class="aster-error">Mermaid error: ${e.message}</pre>`;
  }
});

window.__aster.commands.register('mermaid.exportSvg', async ({ source }) => {
  const m = await loadMermaid();
  if (!m) throw new Error('mermaid not loaded');
  const id = 'export-' + Math.random().toString(36).slice(2);
  const { svg } = await m.render(id, source);
  return { svg };
});
