import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBackgroundSync } from '../hooks/useBackgroundSync';
import { logDev } from '../lib/utils';
import {
  readLocalHealthAssessments,
  readLocalHouseholds,
  readLocalIndividuals,
  readLocalInventoryItems,
  readLocalSupplyDisbursements,
  readSyncQueue,
} from '../services/localDatabase';
import { MabisaDataContext, emptySnapshot, type LocalSnapshot, type MabisaDataContextValue } from './mabisaData';

export function MabisaDataProvider({ bhwId, children }: { bhwId: string; children: React.ReactNode }) {
  const backgroundSync = useBackgroundSync();
  const [snapshot, setSnapshot] = useState<LocalSnapshot>(emptySnapshot);
  const [message, setMessage] = useState<string | null>(null);
  const [syncingManually, setSyncingManually] = useState(false);
  
  const [syncError, setSyncError] = useState<string | null>(null); 

  const refreshLocalData = useCallback(async () => {
    const [households, individuals, assessments, inventoryItems, disbursements, queue] = await Promise.all([
      readLocalHouseholds(),
      readLocalIndividuals(),
      readLocalHealthAssessments(),
      readLocalInventoryItems(),
      readLocalSupplyDisbursements(),
      readSyncQueue(),
    ]);

    setSnapshot({
      households,
      individuals,
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
    setSyncError(null); 

    try {
      const result = await backgroundSync.runSync();
      await refreshLocalData();
      
      if (result.status === 'synced') {
        setMessage(`Synced ${result.processed} queued change(s).`);
      } else {
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

  const value = useMemo<MabisaDataContextValue>(
    () => ({
      bhwId,
      snapshot,
      message,
      setMessage,
      syncStatus: syncError ? `Error: ${syncError}` : backgroundSync.status,
      isOnline: backgroundSync.isOnline,
      syncingManually,
      refreshLocalData,
      runManualSync,
    }),
    [backgroundSync.isOnline, backgroundSync.status, bhwId, message, refreshLocalData, runManualSync, snapshot, syncingManually, syncError],
  );

  return <MabisaDataContext.Provider value={value}>{children}</MabisaDataContext.Provider>;
}