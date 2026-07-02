import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBackgroundSync } from '../hooks/useBackgroundSync';
import { logDev } from '../lib/utils';
import {
  readLocalHealthAssessments,
  readLocalInventoryItems,
  readLocalResidents,
  readLocalSupplyDisbursements,
  readSyncQueue,
} from '../services/localDatabase';
import { MabisaDataContext, emptySnapshot, type LocalSnapshot, type MabisaDataContextValue } from './mabisaData';

export function MabisaDataProvider({ bhwId, children }: { bhwId: string; children: React.ReactNode }) {
  const backgroundSync = useBackgroundSync();
  const [snapshot, setSnapshot] = useState<LocalSnapshot>(emptySnapshot);
  const [message, setMessage] = useState<string | null>(null);
  const [syncingManually, setSyncingManually] = useState(false);

  // Shared offline snapshot for BHW mobile screens and Admin monitoring views.
  const refreshLocalData = useCallback(async () => {
    const [residents, assessments, inventoryItems, disbursements, queue] = await Promise.all([
      readLocalResidents(),
      readLocalHealthAssessments(),
      readLocalInventoryItems(),
      readLocalSupplyDisbursements(),
      readSyncQueue(),
    ]);

    setSnapshot({
      residents,
      assessments,
      inventoryItems,
      disbursements,
      pendingQueueCount: queue.length,
    });
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refreshLocalData();
    }, 0);

    return () => {
      window.clearTimeout(handle);
    };
  }, [refreshLocalData, backgroundSync.lastResult]);

  const runManualSync = useCallback(async () => {
    setSyncingManually(true);

    try {
      const result = await backgroundSync.runSync();
      await refreshLocalData();
      setMessage(result.status === 'synced' ? `Synced ${result.processed} queued change(s).` : result.errorMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Manual synchronization failed';
      logDev('Manual sync refresh failed', message);
      setMessage(message);
    } finally {
      setSyncingManually(false);
    }
  }, [backgroundSync, refreshLocalData]);

  const value = useMemo<MabisaDataContextValue>(
    () => ({
      bhwId,
      snapshot,
      message,
      setMessage,
      syncStatus: backgroundSync.status,
      isOnline: backgroundSync.isOnline,
      syncingManually,
      refreshLocalData,
      runManualSync,
    }),
    [backgroundSync.isOnline, backgroundSync.status, bhwId, message, refreshLocalData, runManualSync, snapshot, syncingManually],
  );

  return <MabisaDataContext.Provider value={value}>{children}</MabisaDataContext.Provider>;
}
