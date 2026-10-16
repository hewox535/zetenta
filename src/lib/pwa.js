// ¿La app corre instalada (pantalla de inicio / PWA) y no en una pestaña del
// navegador? Android/Chrome lo expone por display-mode; iOS Safari por
// navigator.standalone.
export function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.navigator.standalone === true;
  } catch { return false; }
}
