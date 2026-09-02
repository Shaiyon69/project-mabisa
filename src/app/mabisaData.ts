import { createContext, useContext } from 'react';
import type { HealthAssessment, InventoryItem } from '../types/database';
import type { DeadLetterEntry } from '../services/localDatabase';
import type { SyncStatus } from '../services/syncService';

export type LocalSnapshot = {
  householdCount: number;
  individualCount: number;
  assessmentCount: number;
  disbursementCount: number;
  /** The few rows the dashboard actually renders — the rest of the history stays in SQLite. */
  latestAssessments: HealthAssessment[];
  inventoryItems: InventoryItem[];
  pendingQueueCount: number;
  // Exhausted retries, set aside — surfaced so a stuck record is visible.
  deadLetterEntries: DeadLetterEntry[];
};

export type MabisaDataContextValue = {
  bhwId: string;
  snapshot: LocalSnapshot;
  message: string | null;
  setMessage: (message: string | null) => void;
  /** The engine status, kept as the union rather than a message string. */
  syncStatus: SyncStatus;
  /** Text for the failure banner, or null when the last pass was not a failure. */
  syncError: string | null;
  /** When the queue last drained, ISO 8601, or null if it never has on this device. */
  lastSyncAt: string | null;
  isOnline: boolean;
  syncingManually: boolean;
  refreshLocalData: () => Promise<void>;
  runManualSync: () => Promise<void>;
  /** Puts every quarantined change back on the queue and immediately retries. */
  retryDeadLetters: () => Promise<void>;
};

export const emptySnapshot: LocalSnapshot = {
  householdCount: 0,
  individualCount: 0,
  assessmentCount: 0,
  disbursementCount: 0,
  latestAssessments: [],
  inventoryItems: [],
  pendingQueueCount: 0,
  deadLetterEntries: [],
};

export const MabisaDataContext = createContext<MabisaDataContextValue | null>(null);

export function useMabisaData() {
  const context = useContext(MabisaDataContext);
  if (!context) {
    throw new Error('useMabisaData must be used within a MabisaDataProvider');
  }
  return context;
}
