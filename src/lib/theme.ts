export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mabisa.theme';

/**
 * The stored choice, or light: the device's dark setting is ignored on purpose. Called from `main.tsx`
 * before the first render, outside React and so outside the error boundary —
 * which is why every access here is guarded: a WebView with site data blocked
 * throws on `localStorage`, and an unguarded throw there is a blank app.
 */
export function readTheme(): Theme {
  try {
    // 'oled' was a third palette reachable only by a second tap on Dark. Anyone
    // holding it lands on dark.
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Storage unavailable — fall through to light.
  }

  return 'light';
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice still applies to this session; it just will not be remembered.
  }
}

/** Every colour token is defined against this attribute; see `index.css`. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
