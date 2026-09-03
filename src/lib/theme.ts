export type Theme = 'light' | 'dark' | 'oled';

const STORAGE_KEY = 'mabisa.theme';

/**
 * The stored choice, or light for anyone who has not picked one. Called from
 * `main.tsx` before the first render as well as from the toggle, so the attribute
 * is on the document before React paints and no theme flash reaches a launch.
 */
export function readTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (stored === 'light' || stored === 'dark' || stored === 'oled') {
    return stored;
  }

  return 'light';
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

/** Every colour token is defined against this attribute; see `index.css`. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
