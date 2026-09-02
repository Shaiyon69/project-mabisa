# BRHP-MSAM

BRHP-MSAM is the Barangay Residents Health Profiling and Medical Supply Allocation Monitoring System. It supports Barangay Health Workers during field visits with offline resident profiling, BMI-based health assessments, and local supply disbursement logging, while preparing queued records for synchronization to the LGU Supabase backend.

The two halves of the name are the two halves of the system: health profiling in the field, and supply allocation monitoring at the LGU.

The system was previously called MABISA. The rename covers what people read — the launcher label, the sign-in screen, the two shells and the documents. It deliberately stops short of identifiers that would cost something to change: the Android `appId` (`ph.mabisa.app`, whose change makes every installed APK a separate app with an empty database), the npm package name, the `localStorage` keys (`mabisa.user_role`, `mabisa.theme`, `mabisa.last_sync_at`, `mabisa.pulled_through`, whose change signs every device out and re-pulls every table), and the `MabisaData*` module names.

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
- Web LGU portal: desktop-first administrative dashboard covering residents, inventory, accounts, and reports.
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
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-anon-key
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

The LGU portal is a static bundle served by nginx. Fill in `.env` from
`.env.example`, then:

```bash
docker compose up -d --build
```

The portal is on `http://localhost:8080`; override with `ADMIN_PORT` in `.env`.

Vite substitutes `import.meta.env.VITE_*` at build time, so the Supabase URL, the
publishable key and the barangay name are build arguments rather than runtime
environment. Changing any of them requires `--build` again — a restart alone keeps
serving the values that were baked in. Only the publishable (anon) key belongs
here; it is exposed in the bundle by design and is safe only because row level
security is enabled on every table. The service role key must never be passed.

The BHW client is deliberately not containerised. It ships as an APK wrapping
`dist/`, and nothing in the field workflow may depend on a server.

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

## Scope

BRHP-MSAM records and reports what health workers observe in the field. It is a record
system, not a diagnostic one: nutrition status is a screening figure derived from height
and weight, and no output here is a clinical finding. The assessment screen states this
where the reading is taken.

Distribution is a sideloaded APK, not a Play Store listing, and accounts are created by
the Rural Health Unit rather than by sign-up. There is no public registration path and
none is planned.
