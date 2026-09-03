import { useState } from 'react';
import { applyTheme, readTheme, storeTheme, type Theme } from '../../lib/theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  function choose(next: Theme) {
    storeTheme(next);
    applyTheme(next);
    setTheme(next);
  }

  // Two labelled buttons, not one that flips — a flip-icon control is a coin-flip to read next to logout.
  return (
    <div className="theme-toggle" role="group" aria-label="Light or dark theme">
      <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => choose('light')}>
        Light
      </button>
      <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => choose('dark')}>
        Dark
      </button>
    </div>
  );
}
