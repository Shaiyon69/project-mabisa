import { useEffect, useState } from 'react';

/** How long the screen may sit untouched before it's covered — an assumption, not an approved figure, hence a single constant. */
const IDLE_LIMIT_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Covers the screen after inactivity — not a sign-out. Signing out a BHW with
 * forty unsent records and no signal would lock them out of their own work.
 * Session, queue and SQLite stay untouched; only what's on screen changes. Not a
 * defence against someone holding the device — that's SQLCipher and the Android lock screen.
 */
export function useIdleLock(): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    // Once covered, activity must not uncover it — only `unlock` clears it.
    if (locked) {
      return;
    }

    let handle = window.setTimeout(() => setLocked(true), IDLE_LIMIT_MS);

    const restart = () => {
      window.clearTimeout(handle);
      handle = window.setTimeout(() => setLocked(true), IDLE_LIMIT_MS);
    };

    // A backgrounded phone is idle whatever the timer says — locks immediately on returning to foreground.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(handle);
        setLocked(true);
      }
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, restart, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearTimeout(handle);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, restart);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [locked]);

  return { locked, unlock: () => setLocked(false) };
}
