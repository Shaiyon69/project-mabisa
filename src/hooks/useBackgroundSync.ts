import { useCallback, useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import { initializeLocalDatabase } from '../services/localDatabase';
import { idleResult, syncPendingQueue, type SyncResult, type SyncStatus } from '../services/syncService';

type BackgroundSyncState = {
  status: SyncStatus;
  isOnline: boolean;
  lastResult: SyncResult | null;
  runSync: () => Promise<SyncResult>;
};

/**
 * How long to wait before re-running a pass that left entries deferred. Matches
 * the engine's first backoff step, so an entry waits at most one extra interval.
 */
const RETRY_POLL_MS = 30_000;

export function useBackgroundSync(): BackgroundSyncState {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const runSync = useCallback(async () => {
    setStatus('syncing');

    try {
      const result = await syncPendingQueue();
      setStatus(result.status);

      // `syncing` means a pass was already running and this call did nothing, so
      // its counters describe no pass. Storing it would overwrite the real result
      // with `deferred: 0`, and the retry effect below would stop re-arming.
      if (result.status !== 'syncing') {
        setLastResult(result);
      }

      return result;
    } catch (error) {
      const failedResult: SyncResult = {
        ...idleResult('failed'),
        errorMessage: error instanceof Error ? error.message : 'Synchronization failed',
      };

      setStatus('failed');
      setLastResult(failedResult);
      return failedResult;
    }
  }, []);

  useEffect(() => {
    let active = true;

    initializeLocalDatabase()
      .then(() => Network.getStatus())
      .then((networkStatus) => {
        if (!active) {
          return;
        }

        setIsOnline(networkStatus.connected);

        if (networkStatus.connected) {
          void runSync();
        } else {
          setStatus('offline');
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setStatus('failed');
        setLastResult({
          ...idleResult('failed'),
          errorMessage: error instanceof Error ? error.message : 'Local database initialization failed',
        });
      });

    const listener = Network.addListener('networkStatusChange', (networkStatus) => {
      setIsOnline(networkStatus.connected);

      if (networkStatus.connected) {
        void runSync();
      } else {
        setStatus('offline');
      }
    });

    return () => {
      active = false;
      void listener.then((handle) => handle.remove());
    };
  }, [runSync]);

  // Wakes deferred entries: without this, a device sitting online with a failed
  // entry retries only on a tap or a network flap. Each pass's `lastResult`
  // re-arms the next timer, and a clean pass stops it. Gated on `deferred`, so an
  // idle device does not re-pull every table on a timer.
  //
  // ponytail: fixed interval, not aligned to the earliest next_attempt_at. Costs
  // a few no-op local reads during a long backoff — no network traffic, since a
  // deferred pass skips the pull. Read the due timestamp back if that changes.
  useEffect(() => {
    if (!isOnline || !lastResult || lastResult.deferred === 0) {
      return;
    }

    const handle = window.setTimeout(() => {
      void runSync();
    }, RETRY_POLL_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [isOnline, lastResult, runSync]);

  return {
    status,
    isOnline,
    lastResult,
    runSync,
  };
}
