import { createContext, useContext } from 'react';
import type { HealthAssessment, InventoryItem, SupplyDisbursement } from '../types/database';
import type { DeadLetterEntry } from '../services/localDatabase';

export type LocalSnapshot = {
  householdCount: number;  // Replaced households: Household[]
  individualCount: number; // Replaced individuals: Individual[]
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
  syncStatus: string;
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