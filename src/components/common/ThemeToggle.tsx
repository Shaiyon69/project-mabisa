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
      {/* A second tap on Dark drops to true-black OLED; undocumented on purpose (a battery trick, not a third menu choice). */}
      <button
        type="button"
        className={theme === 'light' ? '' : 'active'}
        onClick={() => choose(theme === 'dark' ? 'oled' : 'dark')}
      >
        {theme === 'oled' ? 'OLED' : 'Dark'}
      </button>
    </div>
  );
}
