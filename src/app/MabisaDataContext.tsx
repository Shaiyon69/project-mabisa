import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBackgroundSync } from '../hooks/useBackgroundSync';
import { logDev } from '../lib/utils';
import {
  readLocalHealthAssessments,
  getHouseholdCount,
  getIndividualCount,
  readLocalInventoryItems,
  readLocalSupplyDisbursements,
  readDeadLetterEntries,
  requeueDeadLetterEntries,
  readSyncQueue,
} from '../services/localDatabase';
import { readLastSyncAt, resetPullWatermark } from '../services/syncService';
import { MabisaDataContext, emptySnapshot, type LocalSnapshot, type MabisaDataContextValue } from './mabisaData';

export function MabisaDataProvider({ bhwId, children }: { bhwId: string; children: React.ReactNode }) {
  const backgroundSync = useBackgroundSync();
  const [snapshot, setSnapshot] = useState<LocalSnapshot>(emptySnapshot);
  const [message, setMessage] = useState<string | null>(null);
  const [syncingManually, setSyncingManually] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null); 

  const refreshLocalData = useCallback(async () => {
    // 1. Fetch lightweight counts instead of massive arrays
    const [householdCount, individualCount, assessments, inventoryItems, disbursements, queue, deadLetterEntries] =
      await Promise.all([
        getHouseholdCount(),
        getIndividualCount(),
        readLocalHealthAssessments(),
        readLocalInventoryItems(),
        readLocalSupplyDisbursements(),
        readSyncQueue(),
        readDeadLetterEntries(),
      ]);

    setSnapshot({
      householdCount,
      individualCount,
      assessments,
      inventoryItems,
      disbursements,
      pendingQueueCount: queue.length,
      deadLetterEntries,
    });
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refreshLocalData().catch((error: unknown) => {
        logDev('Local snapshot refresh failed', error instanceof Error ? error.message : error);
      });
    }, 0);

    return () => {
      window.clearTimeout(handle);
    };
  }, [refreshLocalData, backgroundSync.lastResult]);

  // A confirmation is the end of an action, not a permanent part of the screen:
  // left up, "Saved Offline" is still sitting above the next household an hour
  // later and stops meaning anything. Nothing is lost when it goes — the rail and
  // SyncStatusCard carry any state that still needs attention.
  useEffect(() => {
    if (!message) {
      return;
    }

    const handle = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(handle);
  }, [message]);

  const runManualSync = useCallback(async () => {
    setSyncingManually(true);
    setSyncError(null); 

    try {
      const result = await backgroundSync.runSync();
      await refreshLocalData();

      // Only a genuine 'failed' raises the red banner. 'syncing' (the concurrency
      // lock was already held), 'offline', 'unauthenticated' and 'deferred' are
      // normal states with no error text — treating them as failures showed
      // "Action Required" for a sync that had simply been deferred.
      switch (result.status) {
        case 'synced':
          setMessage(`Synced ${result.processed} queued change(s).`);
          break;
        case 'syncing':
          setMessage('A sync is already running.');
          break;
        case 'deferred':
          setMessage(result.errorMessage);
          break;
        case 'offline':
          setMessage('Offline. Changes stay on this device and sync when a connection returns.');
          break;
        case 'unauthenticated':
          setMessage(result.errorMessage);
          break;
        default:
          setMessage(result.errorMessage);
          setSyncError(result.errorMessage ?? 'Unknown sync failure');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Manual synchronization failed';
      logDev('Manual sync refresh failed', errorMessage);
      setMessage(errorMessage);
      setSyncError(errorMessage);
    } finally {
      setSyncingManually(false);
    }
  }, [backgroundSync, refreshLocalData]);

  const retryDeadLetters = useCallback(async () => {
    setSyncingManually(true);
    setSyncError(null);

    try {
      // The pull skipped these records' server rows while they sat quarantined,
      // and its watermark has moved past them since. Forget it so the retry pass
      // reads the central copies again and the two versions can be compared.
      resetPullWatermark();
      const requeued = await requeueDeadLetterEntries();
      setMessage(`Returned ${requeued} set-aside change(s) to the sync queue.`);
      await runManualSync();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Could not requeue set-aside changes';
      logDev('Dead letter requeue failed', errorMessage);
      setMessage(errorMessage);
      setSyncError(errorMessage);
    } finally {
      setSyncingManually(false);
    }
  }, [runManualSync]);

  const value = useMemo<MabisaDataContextValue>(
    () => ({
      bhwId,
      snapshot,
      message,
      setMessage,
      syncStatus: backgroundSync.status,
      // `syncError` only covers the manual path. A background pass that fails
      // carries its reason on the result instead, so fall back to that rather
      // than showing a bare "Action Required" with nothing to act on.
      syncError:
        syncError ?? (backgroundSync.status === 'failed' ? backgroundSync.lastResult?.errorMessage ?? null : null),
      isOnline: backgroundSync.isOnline,
      // Re-read rather than held in state: the engine writes it, and `lastResult`
      // in the dependency list below means a finished pass re-reads it.
      lastSyncAt: readLastSyncAt(),
      syncingManually,
      refreshLocalData,
      runManualSync,
      retryDeadLetters,
    }),
    [
      backgroundSync.isOnline,
      backgroundSync.lastResult,
      backgroundSync.status,
      bhwId,
      message,
      refreshLocalData,
      retryDeadLetters,
      runManualSync,
      snapshot,
      syncingManually,
      syncError,
    ],
  );

  return <MabisaDataContext.Provider value={value}>{children}</MabisaDataContext.Provider>;
}
