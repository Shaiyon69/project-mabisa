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

The migrations are not kept in this repo — the schema is managed in the Supabase project directly. The central tables are `households`, `individuals`, `health_assessments`, `inventory_items`, and `supply_disbursements`, with Row Level Security enabled on all of them. The local SQLite tables mirror these names one-to-one.

Row shapes are declared in `src/types/database.ts`. That file is not currently enforced against the live schema (the Supabase client is untyped), so treat it as documentation rather than a guarantee.

## Offline Mobile Flow

The mobile client initializes local SQLite tables through:

```text
src/services/localDatabase.ts
```

Data entry forms write to local SQLite first. Each create or update also writes a matching entry to `sync_queue`. The background sync service reads pending queue entries when network connectivity is restored and pushes them to Supabase sequentially.

## Project Layout

```text
src/app/          routing and the shared data context
src/pages/        route-level pages, split by surface (admin, bhw, auth)
src/components/   admin/, bhw/, and a shared common/ UI kit
src/services/     localDatabase.ts (SQLite) and syncService.ts (queue replay)
src/hooks/        useBackgroundSync.ts
src/types/        database.ts row shapes
utils/supabase.ts Supabase client, re-exported by src/lib/supabase.ts
```

Two surfaces share this codebase. `/bhw` is the phone-sized field client with a bottom
tab bar; `/admin` is the desktop LGU portal with a sidebar. Each sits behind its own
layout, and both read the same device-local SQLite database rather than querying
Supabase directly.
