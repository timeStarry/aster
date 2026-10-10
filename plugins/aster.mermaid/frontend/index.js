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

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Mermaid colors taken from the app's current theme tokens. */
function mermaidConfig() {
  const scheme = getComputedStyle(document.documentElement).colorScheme || '';
  const dark = scheme.includes('dark');
  const fg = cssVar('--fg') || (dark ? '#e7e5e4' : '#1c1917');
  return {
    startOnLoad: false,
    // 'strict' sanitizes labels and disables click handlers.
    securityLevel: 'strict',
    theme: 'base',
    darkMode: dark,
    themeVariables: {
      background: cssVar('--bg') || (dark ? '#1c1917' : '#fbfbfa'),
      primaryColor: cssVar('--surface-2') || (dark ? '#35302e' : '#f5f5f4'),
      primaryTextColor: fg,
      primaryBorderColor: cssVar('--accent') || '#4f46e5',
      secondaryColor: cssVar('--surface') || (dark ? '#292524' : '#ffffff'),
      tertiaryColor: cssVar('--code-bg') || (dark ? '#292524' : '#f4f4f5'),
      lineColor: cssVar('--fg-muted') || (dark ? '#a8a29e' : '#57534e'),
      textColor: fg,
      titleColor: fg,
      edgeLabelBackground: cssVar('--bg') || (dark ? '#1c1917' : '#fbfbfa'),
      fontFamily: cssVar('--font-ui') || 'sans-serif',
    },
  };
}

async function ready() {
  const mermaid = await loadMermaid();
  const cfg = mermaidConfig();
  // Re-initialize whenever the palette changed, not only light/dark.
  const fp = JSON.stringify(cfg.themeVariables) + cfg.darkMode;
  if (fp !== currentTheme) {
    mermaid.initialize(cfg);
    currentTheme = fp;
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
