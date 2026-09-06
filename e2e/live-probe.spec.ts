import { test, expect, type Page } from '@playwright/test';

/** Temporary: signs in against the live project to time the real admin load. Delete after use. */

const EMAIL = process.env.PROBE_EMAIL ?? '';
const PASSWORD = process.env.PROBE_PASSWORD ?? '';

type Call = { path: string; status: number; ms: number; bytes: number };

function watch(page: Page, calls: Call[]) {
  page.on('requestfinished', async (request) => {
    if (!request.url().includes('/rest/v1/')) {
      return;
    }

    const response = await request.response();
    const timing = request.timing();
    const url = new URL(request.url());
    let bytes = 0;

    try {
      bytes = (await response?.body())?.length ?? 0;
    } catch {
      bytes = 0;
    }

    calls.push({
      path: `${url.pathname.replace('/rest/v1/', '')}?${url.search.slice(1, 90)}`,
      status: response?.status() ?? 0,
      ms: Math.round(timing.responseEnd - timing.requestStart),
      bytes,
    });
  });

  page.on('requestfailed', (request) => {
    if (request.url().includes('/rest/v1/')) {
      calls.push({ path: `FAILED ${request.url().slice(0, 90)}`, status: -1, ms: 0, bytes: 0 });
    }
  });
}

function report(title: string, calls: Call[]) {
  console.log(`\n--- ${title} ---`);
  for (const call of calls) {
    console.log(`  ${String(call.status).padStart(4)}  ${String(call.ms).padStart(6)}ms  ${String(call.bytes).padStart(8)}B  ${call.path}`);
  }
}

async function signIn(page: Page) {
  await page.goto('/admin');
  await page.getByRole('textbox', { name: 'Email' }).fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: /Sign in as Admin/i }).click();
}

test('live admin portal load and nutrition drill-down', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const calls: Call[] = [];
  watch(page, calls);

  const started = Date.now();
  await signIn(page);

  await expect(page.getByLabel('Admin metrics')).toBeVisible({ timeout: 180_000 });
  // The tiles render at zero while the snapshot is still arriving, so the real
  // wait is until a figure other than zero appears.
  await expect(page.locator('.metric').first().locator('strong')).not.toHaveText('0', { timeout: 180_000 });
  const dashboardMs = Date.now() - started;

  report('dashboard load', calls);
  console.log(`\n  DASHBOARD READY: ${dashboardMs} ms  (${calls.length} REST calls)`);

  // Analytics is the screen that walks every barangay.
  calls.length = 0;
  const analyticsStart = Date.now();
  await page.getByRole('link', { name: /Open analytics/i }).first().click();
  await expect(page.getByRole('heading', { name: 'Assessment coverage' })).toBeVisible({ timeout: 180_000 });
  const analyticsMs = Date.now() - analyticsStart;

  report('analytics load', calls);
  console.log(`\n  ANALYTICS READY: ${analyticsMs} ms`);

  const rings = await page.locator('.gauge-grid .gauge-ring, .gauge-grid > *').count();
  const note = await page.locator('.report-note').filter({ hasText: 'thin ring' }).innerText();
  console.log(`  COVERAGE RINGS DRAWN: ${rings}`);
  console.log(`  COVERAGE NOTE: ${note.replace(/\s+/g, ' ').trim()}`);

  // The drill-down under test: the nutrition band link off the dashboard.
  calls.length = 0;
  await page.goto('/admin');
  await expect(page.getByLabel('Admin metrics')).toBeVisible({ timeout: 180_000 });

  const band = page.locator('a.summary-bar-link[href*="status=normal"]').first();
  await expect(band).toBeVisible({ timeout: 180_000 });
  console.log(`\n  BAND HREF: ${await band.getAttribute('href')}`);

  page.on('console', (message) => console.log(`  CONSOLE[${message.type()}]: ${message.text().slice(0, 300)}`));
  page.on('pageerror', (error) => console.log(`  PAGEERROR: ${String(error).slice(0, 300)}`));
  page.on('request', (request) => {
    if (request.url().includes('resident_id=in.')) {
      console.log(`  SENT in.() REQUEST, url length = ${request.url().length}`);
    }
  });
  page.on('requestfailed', (request) => {
    console.log(`  REQUESTFAILED (${request.failure()?.errorText}) len=${request.url().length} ${request.url().slice(0, 80)}`);
  });

  calls.length = 0;
  const drillStart = Date.now();
  await band.click();
  await page.waitForTimeout(30_000);
  const drillMs = Date.now() - drillStart;

  report('nutrition drill-down', calls);
  console.log(`\n  DRILL-DOWN SETTLED: ${drillMs} ms`);

  const failures = calls.filter((call) => call.status >= 400 || call.status === -1);
  console.log(`  NON-2XX CALLS: ${failures.length}`);

  const body = await page.locator('main').innerText();
  console.log(`  SCREEN TEXT (first 400): ${body.slice(0, 400).replace(/\s+/g, ' ')}`);
});
