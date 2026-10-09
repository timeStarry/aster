// Renders ```mermaid fenced blocks (Mermaid vendored under ./vendor).
let mermaidPromise = null;
let currentTheme = null;
let seq = 0;

function loadMermaid() {
  if (!mermaidPromise) {
    // The vendored build is a classic-script IIFE that assigns
    // globalThis.mermaid via a top-level `var`. Evaluated as an ES module that
    // var is module-scoped and the assignment throws, so inject a <script>.
    mermaidPromise = new Promise((resolve, reject) => {
      if (globalThis.mermaid) return resolve(globalThis.mermaid);
      const el = document.createElement('script');
      el.src = new URL('./vendor/mermaid.min.js', import.meta.url).href;
      el.async = true;
      el.onload = () => (globalThis.mermaid ? resolve(globalThis.mermaid) : reject(new Error('Mermaid did not initialize')));
      el.onerror = () => reject(new Error('Could not load Mermaid'));
      document.head.appendChild(el);
    });
    // Allow a retry after a failed load.
    mermaidPromise.catch(() => { mermaidPromise = null; });
  }
  return mermaidPromise;
}

function wantedTheme() {
  const scheme = getComputedStyle(document.documentElement).colorScheme || '';
  return scheme.includes('dark') ? 'dark' : 'neutral';
}

async function ready() {
  const mermaid = await loadMermaid();
  const theme = wantedTheme();
  if (theme !== currentTheme) {
    // securityLevel 'strict' sanitizes labels and disables click handlers.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
    currentTheme = theme;
  }
  return mermaid;
}

async function render(source) {
  const mermaid = await ready();
  const id = `aster-mermaid-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } finally {
    // On a parse error Mermaid leaves its scratch/error node in <body>.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

window.__aster.renderers.register('mermaid', render);

window.__aster.commands.register('mermaid.exportSvg', async ({ source }) => ({ svg: await render(source) }));
