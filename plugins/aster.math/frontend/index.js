// Renders ```math fenced blocks with KaTeX (vendored under ./vendor).
let katexPromise = null;

function loadKatex() {
  if (!katexPromise) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('./vendor/katex.min.css', import.meta.url).href;
    document.head.appendChild(css);
    katexPromise = import('./vendor/katex.mjs').then((m) => m.default ?? m);
  }
  return katexPromise;
}

window.__aster.renderers.register('math', async (source) => {
  const katex = await loadKatex();
  // throwOnError:false renders invalid TeX inline in red instead of failing
  // the whole block; trust:false (default) blocks \href/\url/\includegraphics.
  return katex.renderToString(source.trim(), {
    displayMode: true,
    throwOnError: false,
    output: 'htmlAndMathml',
  });
});
