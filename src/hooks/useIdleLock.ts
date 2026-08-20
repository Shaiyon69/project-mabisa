import { useEffect, useState } from 'react';

/**
 * How long the screen may sit untouched before it is covered.
 *
 * Fifteen minutes is an assumption, not an approved figure — Phase 0 has never
 * fixed one. It lives here as a single constant so answering that question is a
 * one-line edit.
 */
const IDLE_LIMIT_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Covers the screen after a stretch of inactivity, and does nothing else.
 *
 * Deliberately not a sign-out. Signing out a BHW who is standing in a purok with
 * no signal and forty unsent records would lock them out of their own work until
 * they found a connection — the app would be destroying access to data it exists
 * to protect. The session, the sync queue and the SQLite file are all untouched
 * here; only what is on screen changes.
 *
 * What that buys is honest and limited: a phone left face-up on a bench stops
 * showing a resident's health record. It is not a defence against someone holding
 * the device — that is SQLCipher on the database and the Android lock screen.
 * A PIN would close the gap and needs a decision nobody has made yet.
 */
export function useIdleLock(): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    // Once covered, activity must not uncover it — otherwise the first stray
    // touch in a pocket undoes the lock. Only `unlock` clears it.
    if (locked) {
      return;
    }

    let handle = window.setTimeout(() => setLocked(true), IDLE_LIMIT_MS);

    const restart = () => {
      window.clearTimeout(handle);
      handle = window.setTimeout(() => setLocked(true), IDLE_LIMIT_MS);
    };

    // A phone that has been in a bag with the app backgrounded is idle, whatever
    // the timer says: coming back to the foreground locks immediately rather than
    // waiting out a fresh fifteen minutes.
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
