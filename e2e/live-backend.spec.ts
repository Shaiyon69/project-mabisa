import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/** The admin portal against the real Supabase project. Runs only with `E2E_LIVE_EMAIL` and `E2E_LIVE_PASSWORD` set to an RHU account. */

const email = process.env.E2E_LIVE_EMAIL;
const password = process.env.E2E_LIVE_PASSWORD;
const OUT = 'ui-report/live';

test.skip(!email || !password, 'needs E2E_LIVE_EMAIL and E2E_LIVE_PASSWORD');
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
test.setTimeout(120_000);

type Traffic = { requests: number; bytes: number; failures: string[] };

function watch(page: Page): Traffic {
  const traffic: Traffic = { requests: 0, bytes: 0, failures: [] };

  page.on('response', async (response) => {
    if (!response.url().includes('/rest/v1/')) return;
    traffic.requests++;
    if (response.status() >= 400) traffic.failures.push(`${response.status()} ${response.url().slice(0, 160)}`);
    traffic.bytes += Number(response.headers()['content-length'] ?? (await response.body().catch(() => Buffer.alloc(0))).length);
  });
  page.on('pageerror', (error) => traffic.failures.push(`pageerror ${String(error).slice(0, 160)}`));

  return traffic;
}

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email!);
  await page.getByPlaceholder('Enter password').fill(password!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
}

async function settle(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
  await page.waitForLoadState('networkidle');
}

test('every admin page reads the live project without an error', async ({ page }) => {
  const traffic = watch(page);
  const report: Record<string, unknown> = {};
  mkdirSync(OUT, { recursive: true });

  await signIn(page);

  for (const [name, path] of [
    ['dashboard', '/admin'],
    ['residents', '/admin/residents'],
    ['health', '/admin/health'],
    ['inventory', '/admin/inventory'],
    ['analytics', '/admin/analytics'],
    ['reports', '/admin/reports'],
    ['accounts', '/admin/accounts'],
  ]) {
    const before = { requests: traffic.requests, bytes: traffic.bytes };
    const started = Date.now();

    await page.goto(path);
    await settle(page);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    report[name] = { ms: Date.now() - started, requests: traffic.requests - before.requests, kilobytes: Math.round((traffic.bytes - before.bytes) / 1000) };
  }

  report.dashboardTiles = await (async () => {
    await page.goto('/admin');
    await settle(page);
    return page.locator('.admin-metrics').innerText();
  })();
  report.unassignedRow = await page.locator('.barangay-rate-list', { hasText: 'Unassigned' }).count();

  writeFileSync(`${OUT}/pages.json`, JSON.stringify(report, null, 2));
  expect(traffic.failures).toEqual([]);
});

test('a search matching hundreds of households pages instead of failing', async ({ page }) => {
  const traffic = watch(page);

  await signIn(page);
  await page.goto('/admin/residents');
  await page.getByLabel('Search residents').fill('1');

  const meta = page.getByText(/Showing \d+ of [\d,]+ residents/);
  await expect(meta).toContainText(/of [\d,]{3,} residents/, { timeout: 30_000 });
  writeFileSync(`${OUT}/search.txt`, await meta.innerText());
  expect(traffic.failures).toEqual([]);
});

test('the nutrition drill-down lists each resident once', async ({ page }) => {
  const traffic = watch(page);

  await signIn(page);
  await page.goto('/admin/residents?status=underweight&from=2026-01-01&to=2026-09-15');
  const meta = page.getByText(/Showing \d+ of [\d,]+ residents/);
  await expect(meta).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
  writeFileSync(`${OUT}/drilldown.txt`, await meta.innerText());
  expect(traffic.failures).toEqual([]);
});

test('exports the resident list', async ({ page }) => {
  const traffic = watch(page);

  await page.addInitScript(() => {
    window.print = () => {
      (window as unknown as { printedRows: number }).printedRows = document.querySelectorAll('.print-report tbody tr').length;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await signIn(page);
  await page.goto('/admin/reports');
  await settle(page);
  await page.getByLabel('Report to export').selectOption('residents');
  await page.getByRole('button', { name: 'Export report' }).click();

  const printed = await expect
    .poll(() => page.evaluate(() => (window as unknown as { printedRows?: number }).printedRows), { timeout: 60_000 })
    .toBeGreaterThan(0)
    .then(() => page.evaluate(() => (window as unknown as { printedRows: number }).printedRows));
  writeFileSync(`${OUT}/export.txt`, String(printed));
  expect(traffic.failures).toEqual([]);
});
