// Registers the Midnight theme; the host applies it via data-theme + this CSS.
window.__aster.themes.register({
  id: 'aster.theme-dark',
  name: 'Midnight',
  i18n: { zh: 'Midnight' },
  cssFile: new URL('./theme.css', import.meta.url).href,
});
