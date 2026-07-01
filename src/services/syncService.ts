import { Network } from '@capacitor/network';
import type {
  HealthAssessment,
  InventoryItem,
  Resident,
  SupplyDisbursement,
} from '../types/database';
import { supabase } from '../lib/supabase';
import {
  initializeLocalDatabase,
  markSyncQueueEntryFailed,
  readSyncQueue,
  removeSyncQueueEntry,
  type LocalTableName,
  type SyncQueueEntry,
} from './localDatabase';

export type SyncStatus = 'idle' | 'offline' | 'syncing' | 'synced' | 'failed';

export type SyncResult = {
  status: SyncStatus;
  processed: number;
  failedQueueId: number | null;
  errorMessage: string | null;
};

type PrimaryKeyByTable = {
  residents: 'resident_id';
  health_assessments: 'assessment_id';
  inventory_items: 'item_id';
  supply_disbursements: 'log_id';
};

const primaryKeys: PrimaryKeyByTable = {
  residents: 'resident_id',
  health_assessments: 'assessment_id',
  inventory_items: 'item_id',
  supply_disbursements: 'log_id',
};

let syncInProgress = false;

export async function isNetworkConnected(): Promise<boolean> {
  const status = await Network.getStatus();
  return status.connected;
}

export async function syncPendingQueue(): Promise<SyncResult> {
  if (syncInProgress) {
    return {
      status: 'syncing',
      processed: 0,
      failedQueueId: null,
      errorMessage: null,
    };
  }

  await initializeLocalDatabase();

  const connected = await isNetworkConnected();
  if (!connected) {
    return {
      status: 'offline',
      processed: 0,
      failedQueueId: null,
      errorMessage: null,
    };
  }

  syncInProgress = true;
  let processed = 0;

  try {
    const queue = await readSyncQueue();

    for (const entry of queue) {
      try {
        await pushQueueEntry(entry);
        await removeSyncQueueEntry(entry.queue_id);
        processed += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Sync failed';
        await markSyncQueueEntryFailed(entry.queue_id, errorMessage);

        return {
          status: 'failed',
          processed,
          failedQueueId: entry.queue_id,
          errorMessage,
        };
      }
    }

    return {
      status: 'synced',
      processed,
      failedQueueId: null,
      errorMessage: null,
    };
  } finally {
    syncInProgress = false;
  }
}

async function pushQueueEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.operation_type === 'INSERT') {
    await insertPayload(entry.target_table, entry.payload);
    return;
  }

  await updatePayload(entry.target_table, entry.payload);
}

async function insertPayload(targetTable: LocalTableName, payload: SyncQueueEntry['payload']): Promise<void> {
  switch (targetTable) {
    case 'residents': {
      const { error } = await supabase.from('residents').upsert(payload as Resident, { onConflict: 'resident_id' });
      if (error) {
        throw error;
      }
      return;
    }
    case 'health_assessments': {
      const { error } = await supabase
        .from('health_assessments')
        .upsert(payload as HealthAssessment, { onConflict: 'assessment_id' });
      if (error) {
        throw error;
      }
      return;
    }
    case 'inventory_items': {
      const { error } = await supabase.from('inventory_items').upsert(payload as InventoryItem, { onConflict: 'item_id' });
      if (error) {
        throw error;
      }
      return;
    }
    case 'supply_disbursements': {
      const { error } = await supabase
        .from('supply_disbursements')
        .upsert(payload as SupplyDisbursement, { onConflict: 'log_id' });
      if (error) {
        throw error;
      }
      return;
    }
  }
}

async function updatePayload(targetTable: LocalTableName, payload: SyncQueueEntry['payload']): Promise<void> {
  const primaryKey = primaryKeys[targetTable];
  const primaryValue = payload[primaryKey as keyof typeof payload];

  if (typeof primaryValue !== 'string') {
    throw new Error(`Missing primary key for ${targetTable} update`);
  }

  switch (targetTable) {
    case 'residents': {
      const update = withoutPrimaryKey(payload as Resident, 'resident_id');
      const { error } = await supabase.from('residents').update(update).eq('resident_id', primaryValue);
      if (error) {
        throw error;
      }
      return;
    }
    case 'health_assessments': {
      const update = withoutPrimaryKey(payload as HealthAssessment, 'assessment_id');
      const { error } = await supabase.from('health_assessments').update(update).eq('assessment_id', primaryValue);
      if (error) {
        throw error;
      }
      return;
    }
    case 'inventory_items': {
      const update = withoutPrimaryKey(payload as InventoryItem, 'item_id');
      const { error } = await supabase.from('inventory_items').update(update).eq('item_id', primaryValue);
      if (error) {
        throw error;
      }
      return;
    }
    case 'supply_disbursements': {
      const update = withoutPrimaryKey(payload as SupplyDisbursement, 'log_id');
      const { error } = await supabase.from('supply_disbursements').update(update).eq('log_id', primaryValue);
      if (error) {
        throw error;
      }
      return;
    }
  }
}

function withoutPrimaryKey<T extends Record<string, unknown>, K extends keyof T>(payload: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...payload };
  delete copy[key];
  return copy as Omit<T, K>;
}
