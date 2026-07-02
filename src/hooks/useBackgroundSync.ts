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

  return {
    status,
    isOnline,
    lastResult,
    runSync,
  };
}
