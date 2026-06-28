# Code Documentation

## System Architecture

Project MABISA uses one React and TypeScript codebase for two application surfaces:

- The mobile BHW client runs through Capacitor on Android and stores operational data locally in SQLite.
- The LGU administrative portal connects directly to Supabase and is planned for Phase 4.
- Supabase provides the central PostgreSQL database, API layer, authentication, and Row Level Security enforcement.

The current implementation contains:

```text
src/App.tsx
src/components/Dashboard.tsx
src/hooks/useBackgroundSync.ts
src/services/localDatabase.ts
src/services/syncService.ts
src/types/database.ts
utils/supabase.ts
supabase/migrations/202606280001_initial_mabisa_schema.sql
```

## Central Supabase Schema

The PostgreSQL schema contains five primary tables:

```text
users
residents
health_assessments
inventory_items
supply_disbursements
```

Relationships:

- `users.user_id` maps to `auth.users.id`.
- `residents.assigned_bhw` references `users.user_id`.
- `health_assessments.resident_id` references `residents.resident_id`.
- `supply_disbursements.item_id` references `inventory_items.item_id`.
- `supply_disbursements.resident_id` references `residents.resident_id`.

RLS behavior:

- LGU and admin users can manage account records, residents, assessments, inventory, and disbursement logs.
- BHW users can view and write resident-linked records assigned to their own `auth.uid()`.
- Inventory records are readable by authenticated users and writable by LGU/admin users.

## Local SQLite Schema

The Android SQLite database is initialized as `mabisa_local`.

Local mirrored tables:

```text
residents
health_assessments
inventory_items
supply_disbursements
```

Each local table mirrors the TypeScript row interfaces from `src/types/database.ts`. These tables preserve UUID primary keys, timestamps, foreign-key relationships, BMI data, nutrition status, stock counts, and disbursement quantities.

Local sync table:

```text
sync_queue
```

`sync_queue` stores:

- `queue_id`
- `operation_type`
- `target_table`
- `payload`
- `created_at`
- `attempts`
- `last_error`

The payload is JSON generated from the strict TypeScript entity or update payload for the target table.

## Offline-First Lifecycle

1. The mobile app starts and initializes SQLite through `initializeLocalDatabase`.
2. A BHW enters a resident, assessment, or disbursement record.
3. The form builds a strict TypeScript entity using the Phase 1 interfaces.
4. The entity is written to the matching local SQLite table.
5. The same entity is added to `sync_queue` as an `INSERT` or `UPDATE`.
6. `useBackgroundSync` listens to Capacitor Network status changes.
7. When the device is online, `syncPendingQueue` reads queued entries in order.
8. Each queued operation is sent to Supabase through the typed client in `utils/supabase.ts`.
9. Successful queue entries are deleted locally.
10. Failed queue entries remain in SQLite with an incremented attempt count and latest error.

## Mobile View Responsibilities

`src/App.tsx` handles BHW login through Supabase Auth and passes the active BHW user ID into the mobile dashboard.

`src/components/Dashboard.tsx` provides:

- Main dashboard with connection state, sync status, and pending queue count
- Resident profile form
- Health assessment form with BMI and nutrition status calculation
- Supply disbursement form that writes a disbursement and updates local inventory stock

All data entry writes to SQLite first. The app does not require immediate network availability for resident profiles, assessments, or disbursements after the BHW has an authenticated session.

## Sync Service Responsibilities

`src/services/syncService.ts` controls queue replay:

- Skips sync when already syncing
- Skips sync when offline
- Processes queue rows sequentially
- Uses Supabase upsert for insert operations
- Uses Supabase update for update operations
- Deletes confirmed queue entries
- Records errors on failed entries

This sequential flow keeps local replay predictable and avoids clearing later records when an earlier dependency fails.
