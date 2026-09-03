import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedPin, signIn } from './session';

/**
 * A measuring sweep, not a regression guard. The rest of the suite runs against
 * empty stubs, so every screen renders its zero state and no aggregation, export
 * or id-list path ever executes. This one seeds a population and records what
 * the app then does: how many reads a screen costs, how long a request URL gets,
 * what lands in plain storage, and whether anything throws on the way.
 *
 * Findings go to ui-report/deep-probe.md. Only the console-error and
 * error-boundary checks assert; the rest report.
 */

const OUT = 'ui-report';

type Finding = { area: string; detail: string };
const findings: Finding[] = [];

function record(area: string, detail: string) {
  findings.push({ area, detail });
}

const BARANGAYS = 3;
const PUROKS_PER_BARANGAY = 6;
/** Enough that a barangay's household list is a long URL rather than a short one. */
const HOUSEHOLDS = 900;
const RESIDENTS = 2400;

function id(prefix: string, index: number): string {
  // Same 36 characters a real uuid costs in a query string.
  return `${prefix}${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`.slice(0, 36);
}

const barangayIds = Array.from({ length: BARANGAYS }, (_, index) => id('b', index));
const purokIds = Array.from({ length: BARANGAYS * PUROKS_PER_BARANGAY }, (_, index) => id('p', index));
const householdIds = Array.from({ length: HOUSEHOLDS }, (_, index) => id('h', index));
const residentIds = Array.from({ length: RESIDENTS }, (_, index) => id('r', index));

const STAMP = '2026-06-01T00:00:00.000Z';

/** Every household in the first barangay, which is what a barangay filter selects. */
const firstBarangayHouseholds = householdIds.filter((_, index) => index % BARANGAYS === 0);

function rowsFor(table: string, userId: string): unknown[] {
  switch (table) {
    case 'barangays':
      return barangayIds.map((barangayId, index) => ({
        barangay_id: barangayId,
        name: `Barangay ${index + 1}`,
        code: `B${index + 1}`,
        is_active: true,
        created_at: STAMP,
        updated_at: STAMP,
        created_by: null,
      }));
    case 'puroks':
      return purokIds.map((purokId, index) => ({
        purok_id: purokId,
        barangay_id: barangayIds[index % BARANGAYS],
        name: `Purok ${index + 1}`,
        code: `P${index + 1}`,
        is_active: true,
        created_at: STAMP,
        updated_at: STAMP,
        created_by: userId,
      }));
    case 'households':
      return householdIds.map((householdId, index) => ({
        household_id: householdId,
        household_number: `HH-${String(index + 1).padStart(4, '0')}`,
        purok_id: purokIds[index % purokIds.length],
        barangay_id: barangayIds[index % BARANGAYS],
        toilet_type: [],
        water_source: [],
        food_production: [],
        health_status_notes: null,
        created_at: STAMP,
        updated_at: STAMP,
      }));
    case 'individuals':
      return residentIds.map((residentId, index) => {
        const household = index % householdIds.length;

        return {
          resident_id: residentId,
          household_id: householdIds[household],
          first_name: `Resident${index}`,
          middle_name: null,
          last_name: `Family${index % 400}`,
          sex: index % 2 === 0 ? 'male' : 'female',
          // Spread across the age bands, including the under-20s the nutrition report counts.
          birthday: `${1950 + (index % 70)}-0${(index % 9) + 1}-15`,
          is_household_head: index % 4 === 0,
          relationship_to_head: index % 4 === 0 ? null : 'child',
          occupation: null,
          educational_attainment: null,
          is_out_of_school_youth: false,
          is_pregnant_nursing_fp: false,
          philhealth_number: null,
          status: 'active',
          status_changed_on: null,
          created_at: STAMP,
          updated_at: STAMP,
          // The `households!inner` embed `fetchResidentPage` selects. Same values
          // the `households` case above gives this resident's household.
          households: {
            household_number: `HH-${String(household + 1).padStart(4, '0')}`,
            barangay_id: barangayIds[household % BARANGAYS],
            purok_id: purokIds[household % purokIds.length],
          },
        };
      });
    case 'health_assessments':
      return residentIds.slice(0, 600).map((residentId, index) => ({
        assessment_id: id('a', index),
        resident_id: residentId,
        assessment_date: `2026-0${(index % 8) + 1}-10`,
        weight: 40 + (index % 40),
        height: 140 + (index % 40),
        bmi: 16 + (index % 18),
        nutrition_status: ['underweight', 'normal', 'overweight', 'obese'][index % 4],
        created_at: STAMP,
        updated_at: STAMP,
      }));
    case 'supply_disbursements':
      return residentIds.slice(0, 300).map((residentId, index) => ({
        log_id: id('d', index),
        resident_id: residentId,
        item_id: id('i', index % 12),
        bhw_id: userId,
        quantity: 1 + (index % 5),
        disbursement_date: `2026-0${(index % 8) + 1}-12`,
        notes: null,
        created_at: STAMP,
        updated_at: STAMP,
      }));
    case 'inventory_items':
      return Array.from({ length: 12 }, (_, index) => ({
        item_id: id('i', index),
        item_name: `Item ${index + 1}`,
        type: ['medicine', 'food', 'equipment', 'hygiene', 'other'][index % 5],
        current_stock: index % 3 === 0 ? 2 : 120,
        reorder_level: 10,
        barangay_id: barangayIds[index % BARANGAYS],
        created_at: STAMP,
        updated_at: STAMP,
      }));
    case 'inventory_allocations':
      return Array.from({ length: 40 }, (_, index) => ({
        allocation_id: id('c', index),
        item_id: id('i', index % 12),
        bhw_id: userId,
        quantity: 5,
        reason: 'routine',
        allocated_by: userId,
        allocated_at: STAMP,
      }));
    case 'bhw_purok_assignments':
      return [
        {
          assignment_id: id('s', 0),
          bhw_id: userId,
          purok_id: purokIds[0],
          started_at: STAMP,
          ended_at: null,
          assigned_by: userId,
          ended_by: null,
          assignment_reason: 'initial',
          end_reason: null,
          created_at: STAMP,
        },
      ];
    default:
      return [];
  }
}

/**
 * Each table's rows, built once. Building them per request crashed the worker:
 * the portal issues dozens of reads and a 2,400-row array was rebuilt and
 * re-stringified for every one of them.
 */
const tables = new Map<string, unknown[]>();

function rowsOnce(table: string, userId: string): unknown[] {
  const key = `${table}|${userId}`;

  if (!tables.has(key)) {
    tables.set(key, rowsFor(table, userId));
  }

  return tables.get(key) as unknown[];
}

/**
 * The page `readAllPages` asked for.
 *
 * `.range()` rides as `offset`/`limit` query params, not a `Range` header. Two
 * earlier runs of this probe read the header, served the whole table to every
 * call and so never returned a short page — the pager then asked again forever,
 * and the traffic figures those runs produced were the loop, not the portal.
 */
function pageOf(rows: unknown[], url: URL): unknown[] {
  const offset = Number(url.searchParams.get('offset') ?? NaN);
  const limit = Number(url.searchParams.get('limit') ?? NaN);

  return Number.isFinite(offset) && Number.isFinite(limit) ? rows.slice(offset, offset + limit) : rows;
}

/** URL and length only. Holding live `Request` objects across a whole run exhausted the worker. */
type Call = { table: string; url: string; length: number };
type Traffic = { calls: Call[]; bytes: number };

/**
 * Serves the seeded population and keeps a tally of what was asked for. Routes
 * registered here win over `signIn`'s stubs, which Playwright resolves
 * last-registered-first.
 */
async function seed(page: Page, userId: string, role: string): Promise<Traffic> {
  const traffic: Traffic = { calls: [], bytes: 0 };

  await page.route('**/rest/v1/**', async (route, request) => {
    const raw = request.url();
    const url = new URL(raw);
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0] ?? '';

    traffic.calls.push({ table, url: raw, length: raw.length });

    if (table.startsWith('rpc/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
      return;
    }

    if (table === 'profiles') {
      const body = JSON.stringify([
        { user_id: userId, role, is_active: true, full_name: 'Test Account', barangay_id: null },
      ]);
      traffic.bytes += body.length;
      await route.fulfill({ status: 200, contentType: 'application/json', body });
      return;
    }

    let rows = rowsOnce(table, userId);

    // The narrowing the server would have done, for the two clauses that change
    // what a screen shows. Everything else is served whole.
    const eqBarangay = url.searchParams.get('barangay_id');

    if (eqBarangay?.startsWith('eq.')) {
      const wanted = eqBarangay.slice(3);
      rows = rows.filter((row) => (row as { barangay_id?: string }).barangay_id === wanted);
    }

    // `households!inner(...)` filters name the embedded column, not the row's own.
    const eqJoined = url.searchParams.get('households.barangay_id');

    if (eqJoined?.startsWith('eq.')) {
      const wanted = eqJoined.slice(3);
      rows = rows.filter(
        (row) => (row as { households?: { barangay_id?: string } }).households?.barangay_id === wanted,
      );
    }

    const like = url.searchParams.get('household_number');

    if (like?.startsWith('ilike.')) {
      const needle = like.slice(6).replaceAll('%', '').toLowerCase();
      rows = rows.filter((row) =>
        String((row as { household_number?: string }).household_number ?? '')
          .toLowerCase()
          .includes(needle),
      );
    }

    const total = rows.length;
    const page = pageOf(rows, url);
    const body = JSON.stringify(page);

    traffic.bytes += body.length;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // `count: 'exact'` reads the total out of Content-Range, not the body.
      headers: { 'content-range': `0-${Math.max(page.length - 1, 0)}/${total}` },
      body,
    });
  });

  return traffic;
}

/**
 * Waits for the reads a navigation triggers to stop arriving.
 *
 * Not `networkidle`: the BHW surface keeps a connection open for the offline
 * engine, so that state never arrives and the wait runs to the timeout.
 */
async function settle(page: Page, traffic?: Traffic) {
  await page.waitForLoadState('domcontentloaded');

  if (!traffic) {
    await page.waitForTimeout(1200);
    return;
  }

  let seen = -1;

  for (let attempt = 0; attempt < 20 && seen !== traffic.calls.length; attempt += 1) {
    seen = traffic.calls.length;
    await page.waitForTimeout(400);
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 200)}`);
  });

  return errors;
}

const ADMIN_SCREENS = ['', 'residents', 'inventory', 'accounts', 'analytics', 'reports'];

test.describe('deep probe', () => {
  test('the portal renders a real population without throwing', async ({ page }) => {
    const errors = collectErrors(page);

    await signIn(page, { role: 'admin', userId: 'admin-probe' });
    const traffic = await seed(page, 'admin-probe', 'admin');

    for (const screen of ADMIN_SCREENS) {
      await page.goto(`/admin/${screen}`);
      await settle(page, traffic);
    }

    record('portal', `${RESIDENTS} residents, ${HOUSEHOLDS} households across ${ADMIN_SCREENS.length} screens`);

    if (errors.length) {
      record('portal errors', errors.slice(0, 10).join(' | '));
    }

    // Ignore the noise a stubbed backend makes; a real throw is the finding.
    const thrown = errors.filter((entry) => entry.startsWith('uncaught:'));
    expect(thrown, thrown.join('\n')).toEqual([]);
  });

  test('what one dashboard load costs, and what six screens cost after it', async ({ page }) => {
    await signIn(page, { role: 'admin', userId: 'admin-cost' });
    const traffic = await seed(page, 'admin-cost', 'admin');

    await page.goto('/admin');
    await settle(page, traffic);

    const firstLoad = traffic.calls.length;
    const firstBytes = traffic.bytes;

    for (const screen of ADMIN_SCREENS.slice(1)) {
      await page.goto(`/admin/${screen}`);
      await settle(page, traffic);
    }

    const afterTabs = traffic.calls.length;

    // `page.goto` reloads, so each screen starts with the snapshot cache empty.
    // This is the cost of opening a bookmark, not of clicking between tabs.
    record(
      'cold load cost',
      `one dashboard load: ${firstLoad} REST calls, ${(firstBytes / 1024).toFixed(0)} kB. ` +
        `Five more cold loads: ${afterTabs - firstLoad} calls, ` +
        `${((traffic.bytes - firstBytes) / 1024).toFixed(0)} kB.`,
    );
  });

  test('what the 60-second poll re-downloads', async ({ page }) => {
    await signIn(page, { role: 'admin', userId: 'admin-poll' });
    const traffic = await seed(page, 'admin-poll', 'admin');

    await page.goto('/admin');
    await settle(page, traffic);

    const beforePoll = traffic.calls.length;
    const bytesBefore = traffic.bytes;

    // Past AUTO_REFRESH_MS in useAdminData, with the tab in front as a person leaves it.
    await page.waitForTimeout(65_000);
    await settle(page, traffic);

    const added = traffic.calls.length - beforePoll;
    const addedBytes = traffic.bytes - bytesBefore;

    record(
      'idle poll',
      `one idle minute on an untouched dashboard: ${added} REST calls, ${(addedBytes / 1024).toFixed(0)} kB. ` +
        `Tables re-read: ${[...new Set(traffic.calls.slice(beforePoll).map((call) => call.table))].join(', ') || 'none'}.`,
    );
  });

  test('how long the residents URL gets when a barangay is picked', async ({ page }) => {
    await signIn(page, { role: 'admin', userId: 'admin-url' });
    const traffic = await seed(page, 'admin-url', 'admin');

    await page.goto(`/admin/residents?barangay=${barangayIds[0]}`);
    await settle(page, traffic);

    const longest = Math.max(0, ...traffic.calls.map((call) => call.length));
    const longestIndividuals = Math.max(
      0,
      ...traffic.calls.filter((call) => call.table === 'individuals').map((call) => call.length),
    );

    record(
      'residents URL',
      `barangay of ${firstBarangayHouseholds.length} households. ` +
        `Longest request URL ${longest} chars. ` +
        `Longest /individuals URL ${longestIndividuals} chars.`,
    );

    // The barangay filter used to send every household id in the barangay, which
    // put this past what a proxy accepts at real population. It is a server-side
    // join now, so the length must not grow with the household count.
    expect(longestIndividuals).toBeLessThan(1000);

    // A search term on top, which is the id list this fix deliberately left alone.
    const search = page.getByLabel('Search residents').first();

    await expect(search).toBeVisible();
    await search.fill('HH-0');
    await settle(page, traffic);

    const withSearch = Math.max(
      0,
      ...traffic.calls.filter((call) => call.table === 'individuals').map((call) => call.length),
    );

    record('residents URL', `with a search term on top: ${withSearch} chars.`);
  });

  test('what a filled household form leaves in plain storage', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-storage' });
    await seedPin(page, 'bhw-storage', '2749');
    await seed(page, 'bhw-storage', 'bhw');

    await page.goto('/bhw/register-resident');

    const gate = page.getByRole('dialog');

    await gate.waitFor({ state: 'visible' });
    await gate.locator('input.pin-input').fill('2749');
    await gate.getByRole('button').last().click();
    await gate.waitFor({ state: 'hidden' });

    const fields: [RegExp, string][] = [
      [/household number/i, 'HH-PROBE-1'],
      [/first name/i, 'Marilou'],
      [/last name/i, 'Bautista'],
      [/philhealth/i, '12-345678901-2'],
    ];

    // Asserted rather than skipped: a fill that quietly found nothing would make
    // the storage check below report "no PII" for a form nobody typed into.
    for (const [label, value] of fields) {
      const field = page.getByLabel(label).first();

      await expect(field, `no field labelled ${label}`).toBeVisible();
      await field.fill(value);
      await expect(field).toHaveValue(value);
    }

    // The draft write is debounced.
    await page.waitForTimeout(1500);

    const storage = await page.evaluate(() =>
      Object.fromEntries(
        Array.from({ length: window.localStorage.length }, (_, index) => {
          const key = window.localStorage.key(index) as string;
          return [key, window.localStorage.getItem(key) ?? ''];
        }),
      ),
    );

    const leaked = Object.entries(storage).filter(([, value]) =>
      /Marilou|Bautista|12-345678901-2|HH-PROBE-1/.test(value),
    );

    record(
      'plain storage',
      leaked.length
        ? `typed PII readable in localStorage under: ${leaked.map(([key]) => key).join(', ')}`
        : `no typed PII in localStorage. Keys present: ${Object.keys(storage).join(', ')}`,
    );
  });

  test('a malformed URL parameter does not blank the portal', async ({ page }) => {
    const errors = collectErrors(page);

    await signIn(page, { role: 'admin', userId: 'admin-bad-url' });
    const traffic = await seed(page, 'admin-bad-url', 'admin');

    await page.goto('/admin/analytics?from=not-a-date&to=99999-13-45');
    await settle(page, traffic);

    const body = (await page.locator('body').innerText()).trim();

    record('malformed URL', body.length ? `screen still renders (${body.length} chars)` : 'BLANK PAGE');
    expect(body.length).toBeGreaterThan(0);

    const thrown = errors.filter((entry) => entry.startsWith('uncaught:'));
    record('malformed URL', thrown.length ? `threw: ${thrown[0]}` : 'nothing thrown');
  });

  test('flipping a filter three times leaves how many reads in flight', async ({ page }) => {
    await signIn(page, { role: 'admin', userId: 'admin-abort' });
    const traffic = await seed(page, 'admin-abort', 'admin');

    // A superseded read is only cancelled if something aborts it; `useAdminData`
    // drops the response with a flag instead, so this is the number that says which.
    const cancelled: string[] = [];

    page.on('requestfailed', (request) => {
      if (request.url().includes('/rest/v1/')) cancelled.push(request.url());
    });

    await page.goto('/admin/residents');
    await settle(page, traffic);

    const before = traffic.calls.length;

    for (const barangayId of [barangayIds[0], barangayIds[1], barangayIds[2]]) {
      await page.goto(`/admin/residents?barangay=${barangayId}`);
      await page.waitForTimeout(150);
    }

    await settle(page, traffic);

    const after = traffic.calls.length;

    record(
      'superseded reads',
      `three fast barangay flips issued ${after - before} REST calls, ${cancelled.length} of them cancelled.`,
    );
  });

  test.afterAll(() => {
    mkdirSync(OUT, { recursive: true });

    const lines = ['# Deep probe', '', `Run ${new Date().toISOString()}`, ''];

    for (const area of [...new Set(findings.map((finding) => finding.area))]) {
      lines.push(`## ${area}`, '');
      for (const finding of findings.filter((entry) => entry.area === area)) {
        lines.push(`- ${finding.detail}`);
      }
      lines.push('');
    }

    writeFileSync(`${OUT}/deep-probe.md`, lines.join('\n'));
  });
});
