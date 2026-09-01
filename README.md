# Project MABISA

Project MABISA is a Mobile-based Application for Assessment of Barangay Inhabitants and Supply Allocation. It supports Barangay Health Workers during field visits with offline resident profiling, BMI-based health assessments, and local supply disbursement logging, while preparing queued records for synchronization to the LGU Supabase backend.

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

Both surfaces live in this one codebase but ship as separate deployments —
`npm run build:mobile` and `npm run build:admin`. A plain `npm run dev` serves both, and
the route guard keeps a session on the surface its role belongs to.

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

## Web Deployment

The admin portal is hosted on Vercel; the BHW client is not, because it ships inside the
APK. `vercel.json` at the repo root pins the build to the admin surface:

```json
{
  "buildCommand": "npm run build:admin",
  "outputDirectory": "dist-admin",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

The rewrite is what lets a deep link like `/admin/residents` survive a refresh — Vercel
serves a real file when one matches, so hashed assets are unaffected.

Import the repository at vercel.com once. After that every push to `main` deploys, and
every branch gets a preview.

Set two project environment variables, for Production and Preview: `VITE_SUPABASE_URL`
and `VITE_SUPABASE_PUBLISHABLE_KEY`. `.env` is gitignored, so the build has nothing
without them, and the Supabase client is constructed at module scope — a missing value is
a blank page rather than a warning. Both are publishable client values and Row Level
Security is the real boundary; the service role key never goes here.

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

Every account has a role in `public.profiles`, and the role decides both which surface
the session lands on and how much of the data it can see. It is set server-side; there
is no sign-up screen, and promotion is a manual SQL update.

| role | sees | writes |
|---|---|---|
| `admin` | every barangay in the RHU | nothing, anywhere |
| `barangay_admin` | one barangay's residents | that barangay's supply stock only |
| `bhw` | one purok's residents | field data in that purok; releases only stock allocated to them |

`admin` is the Rural Health Unit's oversight account — municipal level, read-only by
design, because an edit made away from the household is indistinguishable from one made
at it. `barangay_admin` is the barangay-level desk account: it cannot touch a resident
record either, but it owns its barangay's supplies and is the only role that can create
stock, receive more of it, or hand a quantity to a named BHW.

Both desk roles sign in to the same admin portal; nothing in the portal branches on
which, beyond hiding the stock controls from an account the database would refuse.

Access is enforced in the database, not the browser. A household is stamped with the
recording BHW's purok by a trigger — never by anything the device sends — and every
other table reaches its scope through that. No account can delete through the API. The
route guard mirrors these rules for convenience, but Row Level Security is the boundary.

Scoping does nothing until barangays, puroks and BHW assignments exist: until a BHW has
an active purok assignment they cannot save a household at all. Cabugao, Salay and
Pag-asa are seeded, each with two puroks and its own administrator; `barangay_roles.sql`
section 11 records what was seeded and how to add another barangay.

## Supabase Schema

The migrations are applied to the Supabase project directly; `barangay_roles.sql` at the repo root is the one kept alongside the code, because it is the file that has to be read before touching a policy. The field tables are `households`, `individuals`, `health_assessments`, `inventory_items`, and `supply_disbursements`; the access model adds `profiles`, `barangays`, `puroks`, `bhw_purok_assignments`, `inventory_allocations` and `audit_events`. Row Level Security is enabled and policied on all of them. The local SQLite tables mirror the five field table names one-to-one — except `inventory_items`, which on a device holds that BHW's own allocated stock, pulled from the `bhw_item_stock` view rather than from the table of the same name.

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
tab bar, and it reads device-local SQLite so it works with no connection. `/admin` is the
desktop portal with a sidebar, and it queries Supabase directly — an oversight surface on
a wired workstation has no use for a mirror of one phone's records. Each sits behind its
own layout.

## Known Limitations

These are current and deliberate, not oversights waiting to be discovered:

- **Nutrition status uses adult BMI cut-points for every resident.** DOH classifies
  children under five by weight-for-age, height-for-age and weight-for-height instead.
  The assessment screen states this on-screen; the correct standard is not yet
  implemented and the result should not be read as a clinical finding for children,
  teenagers, or pregnant women.
- **Stock has no unit of measure, batch, expiry or reorder threshold.** An item is a
  name, a type and a count. Releases now move real quantities — a barangay administrator
  creates and receives stock, allocates it to named BHWs, and a device can release only
  what its holder was given, checked again server-side on arrival — but the model behind
  those quantities is still a placeholder that needs a working BHW's requirements before
  it is built out.
- **A phone never pulls back assessments or disbursements.** The admin portal reads the
  central database directly and is unaffected, but a device sync fetches only
  households, individuals and its holder's own stock. A BHW who reinstalls, or picks up
  a second device, sees no assessment history for residents that do sync down.
- **A report's barangay name still comes from the build.** `VITE_BARANGAY_NAME` is baked
  into the bundle, which was right when a deployment served one barangay. Now that the
  database holds several, an RHU export covering all of them prints whichever name that
  build was compiled with. The name should be read off the rows instead.
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
