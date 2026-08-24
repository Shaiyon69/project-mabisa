import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBackgroundSync } from '../hooks/useBackgroundSync';
import { logDev } from '../lib/utils';
import {
  readLocalHealthAssessments,
  getHouseholdCount,
  getIndividualCount,
  getHealthAssessmentCount,
  getSupplyDisbursementCount,
  getSyncQueueCount,
  readLocalInventoryItems,
  readDeadLetterEntries,
  requeueDeadLetterEntries,
} from '../services/localDatabase';
import { readLastSyncAt, resetPullWatermark } from '../services/syncService';
import { MabisaDataContext, emptySnapshot, type LocalSnapshot, type MabisaDataContextValue } from './mabisaData';

/** Recent checks shown on the dashboard. Matches what BHWDashboard renders. */
const DASHBOARD_ASSESSMENTS = 3;

export function MabisaDataProvider({ bhwId, children }: { bhwId: string; children: React.ReactNode }) {
  const backgroundSync = useBackgroundSync();
  const [snapshot, setSnapshot] = useState<LocalSnapshot>(emptySnapshot);
  const [message, setMessage] = useState<string | null>(null);
  const [syncingManually, setSyncingManually] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null); 

  const refreshLocalData = useCallback(async () => {
    // Counts where the UI only counts. The pull now brings a whole purok's history
    // onto the device, so reading these as rows would parse all of it every refresh.
    const [
      householdCount,
      individualCount,
      assessmentCount,
      disbursementCount,
      latestAssessments,
      inventoryItems,
      pendingQueueCount,
      deadLetterEntries,
    ] = await Promise.all([
      getHouseholdCount(),
      getIndividualCount(),
      getHealthAssessmentCount(),
      getSupplyDisbursementCount(),
      readLocalHealthAssessments(undefined, DASHBOARD_ASSESSMENTS),
      readLocalInventoryItems(),
      getSyncQueueCount(),
      readDeadLetterEntries(),
    ]);

    setSnapshot({
      householdCount,
      individualCount,
      assessmentCount,
      disbursementCount,
      latestAssessments,
      inventoryItems,
      pendingQueueCount,
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

  // A confirmation auto-clears rather than sitting on screen forever — the rail
  // and SyncStatusCard carry any state that still needs attention.
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

      // Only 'failed' raises the red banner — the other statuses are normal states with no error text.
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
      // Forgets the pull watermark so the retry pass re-reads the central copies these records missed while quarantined.
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
      // Manual failures set syncError directly; a background failure falls back to lastResult's reason.
      syncError:
        syncError ?? (backgroundSync.status === 'failed' ? backgroundSync.lastResult?.errorMessage ?? null : null),
      isOnline: backgroundSync.isOnline,
      // Re-read, not held in state — lastResult in the deps below triggers a re-read after each pass.
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
