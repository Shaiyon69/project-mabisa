import { useCallback, useEffect, useState } from 'react';
import { checkForAppUpdate, type AvailableUpdate } from '../services/appUpdate';

/** Which version the health worker said "later" to. Dismissing 1.2.0 still lets 1.3.0 through. */
const DISMISSED_KEY = 'mabisa.update_dismissed';

export type AppUpdateState = {
  update: AvailableUpdate | null;
  dismiss: () => void;
};

/**
 * Checks once per launch. No polling and no resume listener, so an update landing
 * mid-shift waits for the next open rather than interrupting a visit.
 */
export function useAppUpdate(): AppUpdateState {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    let active = true;

    void checkForAppUpdate().then((found) => {
      if (!active || !found) {
        return;
      }

      try {
        if (localStorage.getItem(DISMISSED_KEY) === found.version) {
          return;
        }
      } catch {
        // Storage unavailable — show it, an extra banner beats a silent one.
      }

      setUpdate(found);
    });

    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!update) {
      return;
    }

    try {
      localStorage.setItem(DISMISSED_KEY, update.version);
    } catch {
      // It comes back next launch. Nothing is lost.
    }

    setUpdate(null);
  }, [update]);

  return { update, dismiss };
}
