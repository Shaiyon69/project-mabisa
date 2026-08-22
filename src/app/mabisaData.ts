import { createContext, useContext } from 'react';
import type { HealthAssessment, InventoryItem, SupplyDisbursement } from '../types/database';
import type { DeadLetterEntry } from '../services/localDatabase';
import type { SyncStatus } from '../services/syncService';

export type LocalSnapshot = {
  householdCount: number;
  individualCount: number;
  assessments: HealthAssessment[];
  inventoryItems: InventoryItem[];
  disbursements: SupplyDisbursement[];
  pendingQueueCount: number;
  // Changes that exhausted their sync retries and were set aside so the queue
  // could keep draining. Surfaced in the UI so a stuck record is visible rather
  // than just a frozen count.
  deadLetterEntries: DeadLetterEntry[];
};

export type MabisaDataContextValue = {
  bhwId: string;
  snapshot: LocalSnapshot;
  message: string | null;
  setMessage: (message: string | null) => void;
  /**
   * The engine status, kept as the union. It used to be flattened into
   * `Error: ${message}` here, which left consumers substring-sniffing prose to
   * decide whether to show an alarm — so rewording a message changed the UI.
   */
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
  assessments: [],
  inventoryItems: [],
  disbursements: [],
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
