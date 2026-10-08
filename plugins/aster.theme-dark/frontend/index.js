// Activated on startup — registers the dark theme with the plugin host
window.__aster.themes.register({
  id: 'aster.theme-dark',
  name: 'Dark',
  cssFile: new URL('theme.css', import.meta.url).href,
});
