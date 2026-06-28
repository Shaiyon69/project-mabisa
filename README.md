# Project MABISA

Project MABISA is a Mobile-based Application for Assessment of Barangay Inhabitants and Supply Allocation. It supports Barangay Health Workers during field visits with offline resident profiling, BMI-based health assessments, and local supply disbursement logging, while preparing queued records for synchronization to the LGU Supabase backend.

## Technical Stack

- React with TypeScript
- Vite
- Capacitor for Android packaging
- Capacitor Community SQLite for device-local storage
- Capacitor Network for connection restoration events
- Supabase self-hosted via Docker for LAN or cloud deployment
- PostgreSQL for central records
- SQLite for offline mobile records

## Application Surfaces

- Mobile BHW client: offline-first forms for residents, health assessments, supply disbursements, and sync status.
- Web LGU portal: Supabase-connected administrative dashboard planned for Phase 4.
- Backend database: Supabase PostgreSQL schema with Row Level Security policies.

## Setup

Install dependencies:

```bash
npm install
```

Create `.env` with Supabase client values:

```bash
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Run TypeScript verification:

```bash
npx tsc -b
```

Run the development server with Node 20.19 or newer:

```bash
npm run dev
```

Build with Node 20.19 or newer:

```bash
npm run build
```

## Supabase Schema

The initial PostgreSQL migration is located at:

```text
supabase/migrations/202606280001_initial_mabisa_schema.sql
```

It creates the central `users`, `residents`, `health_assessments`, `inventory_items`, and `supply_disbursements` tables with RLS policies for LGU/admin access and BHW-scoped resident data.

## Offline Mobile Flow

The mobile client initializes local SQLite tables through:

```text
src/services/localDatabase.ts
```

Data entry forms write to local SQLite first. Each create or update also writes a matching entry to `sync_queue`. The background sync service reads pending queue entries when network connectivity is restored and pushes them to Supabase sequentially.

## Documentation

Detailed architecture notes are available at:

```text
docs/CODE_DOCUMENTATION.md
```
