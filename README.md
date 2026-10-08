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
- **Web LGU portal** (`/admin`): Dashboard, Residents, Health, Inventory, Analytics (split into Residents, Health and Supplies sub-tabs), Reports (print-ready documents) and Accounts.
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
  "cleanUrls": true,
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

Every push to `main` that touches the mobile app is a release. `.github/workflows/release.yml`
runs on pushes that change `src/`, `android/`, `public/` or the build config — admin-only
screens under `src/pages/admin/` and `src/components/admin/` excluded — and:

1. runs the type-check, lint and tests;
2. builds the mobile bundle with the real Supabase values and syncs it into Android;
3. builds a signed APK with `versionName` `MAJOR.MINOR.PATCH` and `versionCode`
   `10 + <run number>`, both passed to Gradle as `VERSION_NAME` / `VERSION_CODE`;
4. publishes it as GitHub release `vMAJOR.MINOR.PATCH`. Phones prompt on their next launch.

`MAJOR.MINOR` lives in `android/app-version.txt`: bump MAJOR for big changes, MINOR for
smaller ones. PATCH counts up on its own — one past the highest published release with
the same `MAJOR.MINOR` — and restarts at 0 after a bump. So `1.0` ships `v1.0.0`,
`v1.0.1`, …, and changing the file to `1.1` ships `v1.1.0` next.

A release can also be started by hand from the Actions tab (`workflow_dispatch`). The
values in `android/app/build.gradle` are only the defaults for a local build.

### First install

BHWs install from the download page at <https://shaiyon69.github.io/project-mabisa/>.
Its source is `site/index.html`, and `.github/workflows/pages.yml` publishes it to GitHub
Pages when it changes (Pages must be set to deploy from GitHub Actions under Settings →
Pages). The page links to
`https://github.com/Shaiyon69/project-mabisa/releases/latest/download/app-release.apk`,
which always resolves to the newest release, so it never needs editing for a new build.
When it can reach the GitHub API it also shows the version, size and date, and says the
app is not available yet if nothing has been released. A plainer static copy is still served from
`/download` on the admin portal's Vercel domain. After that first install the update bar
handles every later version.

### Compatibility

Phones update when a BHW taps Install, not when a release lands, so several app versions
are always syncing against the same database at once. The rules that keep them all working:

- **Server changes are additive.** New columns are nullable or have a default, so an older
  build's upsert, which does not name them, still succeeds. Older builds also ignore new
  columns when they pull, because the local write names its own columns
  (`buildUpsert` in `src/services/localDatabase.ts`).
- **Never drop or rename a column, view or RPC argument an app version in the field still
  uses.** Add the new one, ship the build that uses it, then remove the old one after
  every device has moved past that version.
- **The local database only moves forward.** Add columns with `columnUpgrades`, drop them
  with `columnRemovals`; both run on every launch, so a phone that skipped several
  versions catches up in one go. Updating over the installed app keeps its database and
  sync queue.
- **When a break is unavoidable,** put the first compatible version in
  `android/min-app-version.txt` (for example `1.1.20`) and push. The release body then
  carries `min-version: 1.1.20`. Older builds keep working offline, but they stop syncing
  and show an update bar with no "Later" button. Their queue waits, untouched, and sends
  after the update. Leave the file empty the rest of the time.

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

## Sign-in Protection and Privacy Terms

Every sign-in asks the person to tick a box, just above the Sign in button, agreeing to the
Terms and Conditions and Privacy Notice under the Data Privacy Act of 2012 (RA 10173). The
blue "Terms and Conditions" link in that line opens the full text, which is bundled in
`src/components/common/TermsNotice.tsx` so a BHW can read it with no connection. Each
agreement is recorded in `terms_acceptances` with the wording's `TERMS_VERSION`. Bump that
version whenever the text changes what a user agrees to.

Three limits on sign-in attempts:

1. **Captcha.** A Cloudflare Turnstile widget appears on the sign-in screen when the build has
   `VITE_TURNSTILE_SITE_KEY`, and its token goes to Supabase with the sign-in and reset
   requests. To turn it on:
   - Create a Turnstile widget. Its hostnames must list the portal's domain and `localhost`,
     because the APK's WebView serves from `https://localhost`.
   - Set `VITE_TURNSTILE_SITE_KEY` everywhere the app is built: `.env`, Vercel, and the
     repository secrets for the release workflow.
   - Ship a portal and an APK built with the key.
   - Only then, in Supabase, go to Authentication → Attack Protection, enable captcha, choose
     Turnstile and paste the secret key. From that moment a build without the key cannot
     sign in.
2. **Server rate limit.** Supabase Auth limits sign-in attempts per IP address
   (Authentication → Rate Limits). This is the limit a script cannot skip.
3. **Device lock.** After five wrong passwords for one email address, the sign-in screen
   locks that address for 30 seconds. Each further wrong password doubles the lock, up to
   15 minutes. A successful sign-in, or a day with no failures, resets the count. This lock
   is only for the person at the screen and is easy to get around. The first two limits are
   the ones that stop an attacker.

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
database/terms_acceptances.sql             who agreed to which privacy terms (not yet applied)
database/rls_initplan.sql                  RLS helpers checked once per query
database/fuzzy_search.sql                  typo-tolerant admin search
```

`barangay_roles.sql` is the file to read before touching a policy.

The field tables are `households`, `individuals`, `health_assessments`, `immunizations`,
`inventory_items` and `supply_disbursements`; the access model adds `profiles`,
`barangays`, `puroks`, `bhw_purok_assignments`, `inventory_allocations` and
`audit_events`. Row Level Security is enabled and policied on all of them.

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
health records — are paged, filtered, searched and counted by the database. While any panel
or list is still reading, it dims and a bar runs across the top of the window.

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
