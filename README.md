# BRHP-MSAM

BRHP-MSAM is the Barangay Residents Health Profiling and Medical Supply Allocation Monitoring System. Barangay Health Workers use it during field visits to profile residents offline, record health checks and immunizations, and log supply releases. The records sync to a central Supabase backend, where barangay and municipal health offices monitor them.

The two halves of the name are the two halves of the system: health profiling in the field, and supply allocation monitoring at the LGU.

The system was previously called MABISA. The rename covers what people read — the launcher label, the sign-in screen, the two shells and the documents. It deliberately stops short of identifiers that would cost something to change: the Android `appId` (`ph.mabisa.app`, whose change makes every installed APK a separate app with an empty database), the npm package name, the `localStorage` keys (`mabisa.user_role`, `mabisa.theme`, `mabisa.last_sync_at`, `mabisa.pulled_through`, whose change signs every device out and re-pulls every table), and the `MabisaData*` module names.

## Technical Stack

- React 19 with TypeScript
- Vite
- Capacitor for Android packaging
- Capacitor Community SQLite for device-local storage
- Capacitor Network for connection restoration events
- Supabase (hosted) for authentication, the central PostgreSQL database and one Edge Function
- Vitest for unit tests, Playwright for end-to-end tests

## Application Surfaces

- **Mobile BHW client** (`/bhw`): offline-first screens for households and residents, health checks, immunizations, supply releases and sync status, behind a device PIN.
- **Web LGU portal** (`/admin`): Dashboard, Residents, Health, Inventory, Analytics, Reports (print-ready documents) and Accounts.
- **Backend database**: Supabase PostgreSQL with Row Level Security enabled and enforced on every table.

Both surfaces live in this one codebase but ship as separate deployments —
`npm run build:mobile` and `npm run build:admin`. A plain `npm run dev` serves both, and
the route guard keeps a session on the surface its role belongs to.

## Setup

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example` with the Supabase client values:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-anon-key
```

Run the development server with Node 20.19 or newer:

```bash
npm run dev
```

Check, test and build:

```bash
npx tsc -b          # type-check
npm run lint
npm test            # unit tests
npm run test:e2e    # Playwright; starts its own dev server
npm run build
```

`npm run test:e2e` needs Chromium once: `npx playwright install chromium`.

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

## Admin Portal Deployment

The LGU portal can also be served as a static bundle by nginx. Fill in `.env` from
`.env.example`, then:

```bash
docker compose up -d --build
```

The portal is on `http://localhost:8080`; override with `ADMIN_PORT` in `.env`.

Vite substitutes `import.meta.env.VITE_*` at build time, so the Supabase URL and the
publishable key are build arguments rather than runtime environment. Changing either
requires `--build` again — a restart alone keeps serving the values that were baked in.
Only the publishable (anon) key belongs here; it is exposed in the bundle by design and is
safe only because row level security is enabled on every table. The service role key must
never be passed.

The BHW client is deliberately not containerised. It ships as an APK wrapping
`dist/`, and nothing in the field workflow may depend on a server.

## Android Build

The app is distributed as a sideloaded APK, not through Google Play.

Copy the built web assets into the native project:

```bash
npm run sync:android
```

Then build the APK. Point `JAVA_HOME` at the JDK bundled with Android Studio (its `jbr`
directory): Gradle 8.11.1 does not support JDK 25.

```bash
cd android
JAVA_HOME="/path/to/android-studio/jbr" ./gradlew assembleDebug
```

The result is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on a
device with USB debugging enabled:

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run open:android` opens the native project in Android Studio, whose Run button
selects the correct JDK on its own.

## Releasing

Devices in the field check for a newer build themselves. On each launch the BHW client
asks the repository's latest GitHub release for its tag, compares it against the installed
`versionName`, and shows an "Update is ready" bar when the release is ahead. The link
hands the APK to the system browser, which downloads it and lets Android's installer take
over. Nothing downloads without a tap, and a check that fails for any reason — no
connection, no release yet, a rate-limited barangay IP — shows nothing at all.

Cutting a release:

1. Bump `versionCode` and `versionName` in `android/app/build.gradle`. `versionCode` is
   what Android compares to decide an install is an upgrade; `versionName` is what the
   update check reads.
2. Commit, then `git tag vX.Y.Z && git push --tags`, where `X.Y.Z` is exactly the new
   `versionName`. `.github/workflows/release.yml` fails the build if the two disagree.
3. The workflow builds the mobile bundle, syncs it into Android, builds a signed APK and
   attaches it to a GitHub release. Phones prompt on their next launch.

### Signing

The workflow needs these repository secrets: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Generate the keystore once and base64 it into the secret:

```bash
keytool -genkeypair -v -keystore release.keystore -alias mabisa \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore
```

**Back the keystore up outside the repository.** Android installs an update only over an
app signed with the same key. Lose this file and no device can ever take another update —
every phone would have to uninstall first, which deletes its encrypted database along with
any records that never synced.

For the same reason the first release-signed APK will not install over a debug build:
debug keys are generated per machine. Any device already carrying a debug install has to
sync its records, uninstall, then install the release APK fresh.

## Roles and Access

Every account has a role in `public.profiles`, and the role decides both which surface
the session lands on and how much of the data it can see.

| role | sees | writes |
|---|---|---|
| `admin` | every barangay in the RHU | barangay administrator accounts |
| `barangay_admin` | one barangay | that barangay's supply stock and its health worker accounts |
| `bhw` | one purok | field data in that purok; releases only stock allocated to them |

`admin` is the Rural Health Unit's oversight account, at municipal level. It never writes
field data or stock, because an edit made away from the household is indistinguishable
from one made at it. `barangay_admin` is the barangay desk account: it cannot touch a
resident record either, but it owns its barangay's supplies — creating stock, receiving
more, handing a quantity to a named BHW — and runs its health workers.

There is no sign-up screen. Each role creates the accounts one rung below it on the
Accounts tab: the RHU appoints barangay administrators, and a barangay administrator
creates health workers and assigns each to a purok. Creating a login needs the service
role, so the portal calls the `create-account` Edge Function, which checks the caller and
creates the profile as them. No path changes an existing account's role.

Access is enforced in the database, not the browser. A household is stamped with the
recording BHW's purok by a trigger — never by anything the device sends — and every
other table reaches its scope through that. No account can delete through the API. The
route guard mirrors these rules for convenience, but Row Level Security is the boundary.

A BHW cannot save a household until they have an active purok assignment.

## Supabase Schema

The migrations are applied to the Supabase project directly. `database/` keeps the SQL
alongside the code:

```text
database/barangay_roles.sql                barangays, puroks, the three roles, scoping and stock
database/health_assessment_extensions.sql  vitals on health checks
database/immunizations.sql                 the vaccination log
database/server_paging.sql                 views and RPC behind the portal's paged tables
database/drop_legacy_users.sql             removal of the pre-profiles role model
database/seed_demo_data.sql                rerunnable demo data for every barangay
```

`barangay_roles.sql` is the file to read before touching a policy.

The field tables are `households`, `individuals`, `health_assessments`, `immunizations`,
`inventory_items` and `supply_disbursements`; the access model adds `profiles`,
`barangays`, `puroks`, `bhw_purok_assignments`, `inventory_allocations` and
`audit_events`. Row Level Security is enabled and policied on all of them.

`seed_demo_data.sql` wipes and regenerates households, residents, checks, immunizations
and supplies, keeping barangays, puroks, accounts and assignments. It must never run
against a database holding real records.

Row shapes are declared in `src/types/database.ts` and the Supabase client is typed against it, so a column that drifts from this file is a build error rather than a runtime failure. The file carries columns and nullability only — check constraints are not represented, so introspect the live schema before writing SQL against any table.

## Offline Mobile Flow

The mobile client keeps its records in device-local SQLite, set up in
`src/services/localDatabase.ts`. The local tables mirror the field tables one-to-one —
except `inventory_items`, which on a device holds that BHW's own allocated stock, pulled
from the `bhw_item_stock` view.

Data entry forms write to local SQLite first. Each create or update also writes a matching
entry to `sync_queue` in the same transaction. When connectivity returns,
`src/services/syncService.ts` pushes queued entries to Supabase in order, backs off and
sets aside entries that keep failing, then pulls what changed on the server.

## Admin Portal Data

The portal queries Supabase directly and never touches the device database. Dashboards,
charts and reports read one snapshot of everything the account may see for the chosen
period. The record lists — residents, inventory, carried stock, accounts and per-resident
health records — are paged, filtered, searched and counted by the database.

## Project Layout

```text
src/app/            routing, the surface guard and the BHW data context
src/pages/          route-level pages, split by surface (admin, bhw, auth)
src/components/     admin/, bhw/, and a shared common/ UI kit
src/services/       localDatabase.ts (SQLite), syncService.ts (queue replay), adminData.ts (portal reads)
src/hooks/          useAdminData, useServerPage, useBackgroundSync, useDeviceLock, useAppUpdate
src/lib/            supabase.ts client, utils.ts, charts.ts, theme.ts and device helpers
src/types/          database.ts row shapes
database/           schema SQL and the demo seed
e2e/                Playwright specs
public/             logo, favicon and the SQLite wasm for the web build
android/            generated native project, committed
```

`/bhw` is the phone-sized field client with a bottom tab bar, and it reads device-local
SQLite so it works with no connection. `/admin` is the desktop portal with a sidebar. Each
sits behind its own layout.

## Scope

BRHP-MSAM records and reports what health workers observe in the field. It is a record
system, not a diagnostic one: nutrition status is a screening figure derived from height
and weight, and no output here is a clinical finding. The assessment screen states this
where the reading is taken.

Distribution is a sideloaded APK, not a Play Store listing, and accounts are created by
the health offices rather than by sign-up. There is no public registration path.
