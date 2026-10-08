// Registers an inline and block math renderer using KaTeX.
// KaTeX is bundled alongside this file as katex.min.js.
let katex;

async function loadKatex() {
  if (katex) return katex;
  try {
    const m = await import('./katex.min.js');
    katex = m.default ?? m;
  } catch (e) {
    console.error('[aster.math] failed to load KaTeX:', e);
  }
  return katex;
}

window.__aster.renderers.register('math', async (source) => {
  const k = await loadKatex();
  if (!k) return `<pre>${source}</pre>`;
  try {
    return k.renderToString(source.trim(), { throwOnError: false, displayMode: true });
  } catch (e) {
    return `<pre class="aster-error">Math error: ${e.message}</pre>`;
  }
});
