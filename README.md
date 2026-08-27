# BRHP-MSAM

BRHP-MSAM is the Barangay Residents Health Profiling and Medical Supply Allocation Monitoring System. It supports Barangay Health Workers during field visits with offline resident profiling, BMI-based health assessments, and local supply disbursement logging, while preparing queued records for synchronization to the LGU Supabase backend.

The two halves of the name are the two halves of the system: health profiling in the field, and supply allocation monitoring at the LGU.

The system was previously called MABISA. The rename covers what people read — the launcher label, the sign-in screen, the two shells and the documents. It deliberately stops short of identifiers that would cost something to change: the Android `appId` (`ph.mabisa.app`, whose change makes every installed APK a separate app with an empty database), the npm package name, the `localStorage` keys (`mabisa.user_role`, `mabisa-language`, `mabisa.theme`, `mabisa.last_sync_at`, `mabisa.pulled_through`, whose change signs every device out and re-pulls every table), and the `MabisaData*` module names.

## Technical Stack

- React 19 with TypeScript
- Vite
- Capacitor for Android packaging
- Capacitor Community SQLite for device-local storage
- Capacitor Network for connection restoration events
- Supabase (hosted) for authentication and the central database
- PostgreSQL for central records
- SQLite for offline mobile records

## Application Surfaces

- Mobile BHW client: offline-first forms for residents, health assessments, supply disbursements, and sync status.
- Web LGU portal: built, not planned. Desktop-first administrative dashboard covering residents, inventory, accounts, and reports.
- Backend database: Supabase PostgreSQL schema with Row Level Security enabled and enforced on every table.

Both surfaces live in this one codebase and are selected by the signed-in account's
role. There is no separate build per surface.

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

Run the tests:

```bash
npm test
```

The suite covers the BMI and nutrition-status calculations and the sync queue's retry
backoff and dependency ordering. The sync loop itself is not yet covered.

## Android Build

The app is distributed as a sideloaded APK, not through Google Play.

Copy the built web assets into the native project:

```bash
npm run sync:android
```

Then build the APK. The `JAVA_HOME` override is required: Gradle 8.11.1 does not
support JDK 25, so the build must run against the JDK bundled with Android Studio.

```bash
cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
```

The result is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on a
device with USB debugging enabled:

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run open:android` opens the native project in Android Studio, whose Run button
selects the correct JDK on its own.

## Roles and Access

Every account has a role in `public.users`: `bhw`, `admin`, or `lgu`. The role decides
which surface the session lands on, and it is set server-side — new accounts are
created as `bhw` by a database trigger, and promotion is a manual SQL update. There is
no sign-up screen.

Access is enforced in the database, not the browser. BHW accounts write resident,
household, assessment and disbursement records; admin and LGU accounts read all of them
and write none. No account can delete through the API. The route guard in the app
mirrors these rules for convenience, but Row Level Security is the actual boundary.

## Supabase Schema

The migrations are not kept in this repo — the schema is managed in the Supabase project directly. The central tables are `households`, `individuals`, `health_assessments`, `inventory_items`, and `supply_disbursements`, with Row Level Security enabled and policied on all of them. The local SQLite tables mirror these names one-to-one.

Row shapes are declared in `src/types/database.ts` and the Supabase client is typed against it, so a column that drifts from this file is a build error rather than a runtime failure. Note that the file carries columns and nullability only — check constraints are not represented, so introspect the live schema before writing SQL against any table.

## Offline Mobile Flow

The mobile client initializes local SQLite tables through:

```text
src/services/localDatabase.ts
```

Data entry forms write to local SQLite first. Each create or update also writes a matching entry to `sync_queue`. The background sync service reads pending queue entries when network connectivity is restored and pushes them to Supabase sequentially.

## Project Layout

```text
src/app/            routing and the shared data context
src/pages/          route-level pages, split by surface (admin, bhw, auth)
src/components/     admin/, bhw/, and a shared common/ UI kit
src/services/       localDatabase.ts (SQLite) and syncService.ts (queue replay)
src/hooks/          useBackgroundSync.ts
src/types/          database.ts row shapes
src/lib/            supabase.ts client, utils.ts, theme.ts
capacitor.config.ts native app id, name, and web asset directory
android/            generated native project, committed
```

Two surfaces share this codebase. `/bhw` is the phone-sized field client with a bottom
tab bar; `/admin` is the desktop LGU portal with a sidebar. Each sits behind its own
layout, and both read the same device-local SQLite database rather than querying
Supabase directly.

## Known Limitations

These are current and deliberate, not oversights waiting to be discovered:

- **Nutrition status uses adult BMI cut-points for every resident.** DOH classifies
  children under five by weight-for-age, height-for-age and weight-for-height instead.
  The assessment screen states this on-screen; the correct standard is not yet
  implemented and the result should not be read as a clinical finding for children,
  teenagers, or pregnant women.
- **Supply disbursement does not change stock.** Releases are logged, but nothing
  decrements inventory and nothing checks availability. No screen creates an inventory
  item yet either, so disbursement is not usable in the field today.
- **The admin portal reads only what its own browser has synced.** Health assessments
  and supply disbursements are pushed to the server but never pulled back, so an LGU
  workstation does not see records collected on other devices.
- **Recording a household again creates a duplicate.** Registration is the only path
  there is: the form mints a new id on every submit and never looks for an existing
  record, so a repeat visit writes a second household and a second set of members.
  Re-recording should update the household in place instead, and that work is blocked on
  deciding what makes two records the same household — `household_number` is free text,
  and no address or location is stored to disambiguate it.
- **Nothing can be edited or deleted after it is recorded.** A misspelled name or a wrong
  birthday is permanent through the app. No table has a DELETE policy, by design.
- **The app has not been run on a physical Android device.** The APK builds, but the
  native SQLite path has so far only been exercised through the browser emulator.
