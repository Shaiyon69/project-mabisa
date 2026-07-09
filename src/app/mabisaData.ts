import { createContext, useContext } from 'react';
import type { HealthAssessment, Household, Individual, InventoryItem, SupplyDisbursement } from '../types/database';

export type LocalSnapshot = {
  households: Household[];
  individuals: Individual[];
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
  households: [],
  individuals: [],
  assessments: [],
  inventoryItems: [],
  disbursements: [],
  pendingQueueCount: 0,
};

export const MabisaDataContext = createContext<MabisaDataContextValue | null>(null);

export function useMabisaData(): MabisaDataContextValue {
  const value = useContext(MabisaDataContext);

  if (!value) {
    throw new Error('useMabisaData must be used inside MabisaDataProvider');
  }

  return value;
}