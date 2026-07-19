import { createContext, useContext } from 'react';
import type { HealthAssessment, InventoryItem, SupplyDisbursement } from '../types/database';

export type LocalSnapshot = {
  householdCount: number;
  individualCount: number;
  assessments: HealthAssessment[];
  inventoryItems: InventoryItem[];
  disbursements: SupplyDisbursement[];
  pendingQueueCount: number;
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
};

export const emptySnapshot: LocalSnapshot = {
  householdCount: 0,
  individualCount: 0,
  assessments: [],
  inventoryItems: [],
  disbursements: [],
  pendingQueueCount: 0,
};

export const MabisaDataContext = createContext<MabisaDataContextValue | null>(null);

export function useMabisaData() {
  const context = useContext(MabisaDataContext);
  if (!context) {
    throw new Error('useMabisaData must be used within a MabisaDataProvider');
  }
  return context;
}
