import { Network } from '@capacitor/network';
import type {
  HealthAssessment,
  Household,
  Individual,
  InventoryItem,
  SupplyDisbursement,
} from '../types/database';
import { logDev } from '../lib/utils';
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

// -----------------------------------------------------------------------------
// Primary Key Mappings
// -----------------------------------------------------------------------------
// This maps every local table to its exact primary key column name.
// This is critical for the generic `updatePayload` function to know 
// which row it is actually targeting in Supabase.

type PrimaryKeyByTable = {
  households: 'household_id';
  individuals: 'resident_id';
  health_assessments: 'assessment_id';
  inventory_items: 'item_id';
  supply_disbursements: 'log_id';
};

const primaryKeys: PrimaryKeyByTable = {
  households: 'household_id',
  individuals: 'resident_id',
  health_assessments: 'assessment_id',
  inventory_items: 'item_id',
  supply_disbursements: 'log_id',
};

// -----------------------------------------------------------------------------
// Sync Engine State
// -----------------------------------------------------------------------------

// A concurrency lock to prevent the app from accidentally starting 
// two sync loops at the exact same time (e.g., if the user mashes a "Sync" button).
let syncInProgress = false;

export async function isNetworkConnected(): Promise<boolean> {
  const status = await Network.getStatus();
  return status.connected;
}

/**
 * The main background loop that reads the local SQLite queue and pushes 
 * pending operations to the Supabase PostgreSQL database.
 */
export async function syncPendingQueue(): Promise<SyncResult> {
  // 1. Check for concurrency lock
  if (syncInProgress) {
    return {
      status: 'syncing',
      processed: 0,
      failedQueueId: null,
      errorMessage: null,
    };
  }

  await initializeLocalDatabase();

  // 2. Hardware network check before attempting any API calls
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
    // 3. Fetch all pending jobs in exact chronological order
    const queue = await readSyncQueue();

    // 4. Process sequentially to maintain relational integrity
    // (e.g., Household must be inserted before its Individuals)
    for (const entry of queue) {
      try {
        await pushQueueEntry(entry);
        
        // If the API call succeeds, safely delete it from the local device
        await removeSyncQueueEntry(entry.queue_id);
        processed += 1;
      } catch (error) {
        // If an API call fails (e.g., Supabase validation error), log it locally,
        // increment the attempt counter, and halt the entire sync process.
        const errorMessage = error instanceof Error ? error.message : 'Sync failed';
        logDev('Offline sync queue entry failed', {
          queueId: entry.queue_id,
          table: entry.target_table,
          operation: entry.operation_type,
          errorMessage,
        });
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
    // 5. Release the concurrency lock regardless of success or failure
    syncInProgress = false;
  }
}

// -----------------------------------------------------------------------------
// Supabase Transport Logic
// -----------------------------------------------------------------------------

async function pushQueueEntry(entry: SyncQueueEntry): Promise<void> {
  if (entry.operation_type === 'INSERT') {
    await insertPayload(entry.target_table, entry.payload);
    return;
  }

  await updatePayload(entry.target_table, entry.payload);
}

/**
 * Handles all new record creations.
 * CRITICAL: Uses `.upsert()` instead of `.insert()`. If the network drops right 
 * after sending data, the device will retry later. Upsert prevents fatal 
 * "Duplicate Primary Key" errors by simply overwriting the row.
 */
async function insertPayload(targetTable: LocalTableName, payload: SyncQueueEntry['payload']): Promise<void> {
  switch (targetTable) {
    case 'households': {
      // The payload arrays (toilet_type, etc.) are native JS arrays here, 
      // which Supabase perfectly translates to text[] in Postgres.
      const { error } = await supabase.from('households').upsert(payload as Household, { onConflict: 'household_id' });
      if (error) throw error;
      return;
    }
    case 'individuals': {
      // The payload boolean (is_household_head) is a native JS boolean here,
      // which Supabase perfectly translates to boolean in Postgres.
      const { error } = await supabase.from('individuals').upsert(payload as Individual, { onConflict: 'resident_id' });
      if (error) throw error;
      return;
    }
    case 'health_assessments': {
      const { error } = await supabase.from('health_assessments').upsert(payload as HealthAssessment, { onConflict: 'assessment_id' });
      if (error) throw error;
      return;
    }
    case 'inventory_items': {
      const { error } = await supabase.from('inventory_items').upsert(payload as InventoryItem, { onConflict: 'item_id' });
      if (error) throw error;
      return;
    }
    case 'supply_disbursements': {
      const { error } = await supabase.from('supply_disbursements').upsert(payload as SupplyDisbursement, { onConflict: 'log_id' });
      if (error) throw error;
      return;
    }
  }
}

/**
 * Handles modifying existing records.
 * Extracts the primary key dynamically and strips it from the update payload 
 * to prevent accidentally altering IDs in the cloud database.
 */
async function updatePayload(targetTable: LocalTableName, payload: SyncQueueEntry['payload']): Promise<void> {
  const primaryKey = primaryKeys[targetTable];
  const primaryValue = payload[primaryKey as keyof typeof payload];

  if (typeof primaryValue !== 'string') {
    throw new Error(`Missing primary key for ${targetTable} update`);
  }

  switch (targetTable) {
    case 'households': {
      const update = withoutPrimaryKey(payload as Household, 'household_id');
      const { error } = await supabase.from('households').update(update).eq('household_id', primaryValue);
      if (error) throw error;
      return;
    }
    case 'individuals': {
      const update = withoutPrimaryKey(payload as Individual, 'resident_id');
      const { error } = await supabase.from('individuals').update(update).eq('resident_id', primaryValue);
      if (error) throw error;
      return;
    }
    case 'health_assessments': {
      const update = withoutPrimaryKey(payload as HealthAssessment, 'assessment_id');
      const { error } = await supabase.from('health_assessments').update(update).eq('assessment_id', primaryValue);
      if (error) throw error;
      return;
    }
    case 'inventory_items': {
      const update = withoutPrimaryKey(payload as InventoryItem, 'item_id');
      const { error } = await supabase.from('inventory_items').update(update).eq('item_id', primaryValue);
      if (error) throw error;
      return;
    }
    case 'supply_disbursements': {
      const update = withoutPrimaryKey(payload as SupplyDisbursement, 'log_id');
      const { error } = await supabase.from('supply_disbursements').update(update).eq('log_id', primaryValue);
      if (error) throw error;
      return;
    }
  }
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

/**
 * Safely removes the primary key from an object before sending it to a 
 * Supabase UPDATE function. Modifying primary keys directly is an anti-pattern.
 */
function withoutPrimaryKey<T extends Record<string, unknown>, K extends keyof T>(payload: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...payload };
  delete copy[key];
  return copy as Omit<T, K>;
}