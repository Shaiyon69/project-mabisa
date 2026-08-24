import { useCallback, useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import { initializeLocalDatabase } from '../services/localDatabase';
import { syncPendingQueue, type SyncResult, type SyncStatus } from '../services/syncService';

export type BackgroundSyncState = {
  status: SyncStatus;
  isOnline: boolean;
  lastResult: SyncResult | null;
  runSync: () => Promise<SyncResult>;
};

/**
 * How long to wait before re-running a pass that left entries deferred. Matches
 * the sync engine's first backoff step, so an entry waits at most one extra
 * interval past the moment it becomes due.
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
      setLastResult(result);
      return result;
    } catch (error) {
      const failedResult: SyncResult = {
        status: 'failed',
        processed: 0,
        deferred: 0,
        deadLettered: 0,
        failedQueueId: null,
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
          status: 'failed',
          processed: 0,
          deferred: 0,
          deadLettered: 0,
          failedQueueId: null,
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

  // Wakes deferred entries — without a timer here, a device sitting online with a
  // failed entry would never retry until the BHW tapped the button or the
  // connection flapped. Each pass's fresh `lastResult` re-arms the next timer, so
  // this walks itself forward and stops once a pass comes back clean. Gated on
  // `deferred` so an idle device doesn't re-pull every table on a timer.
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
