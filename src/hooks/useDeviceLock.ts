import { useCallback, useEffect, useState } from 'react';

/** How long the screen may sit untouched before the PIN is asked for again. */
const IDLE_LIMIT_MS = 15 * 60 * 1000;

/**
 * Backgrounding for less than this does not cost a PIN entry. Taking a call
 * mid-visit is constant in the field.
 */
const BACKGROUND_GRACE_MS = 30 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * When the app must ask for the device PIN again. Starts locked, since a lock a
 * force-quit walks past is not a lock. Locking never signs anyone out and never
 * touches the queue or SQLite.
 */
export function useDeviceLock(): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(true);

  const unlock = useCallback(() => setLocked(false), []);

  useEffect(() => {
    // Once locked, activity must not clear it — only a correct PIN does.
    if (locked) {
      return;
    }

    let handle = window.setTimeout(() => setLocked(true), IDLE_LIMIT_MS);
    let hiddenAt: number | null = null;

    const restart = () => {
      window.clearTimeout(handle);
      handle = window.setTimeout(() => setLocked(true), IDLE_LIMIT_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        window.clearTimeout(handle);
        return;
      }

      // Back in the foreground: lock only if it was away long enough to have left someone's hands.
      if (hiddenAt !== null && Date.now() - hiddenAt >= BACKGROUND_GRACE_MS) {
        setLocked(true);
        return;
      }

      hiddenAt = null;
      restart();
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

  return { locked, unlock };
}
