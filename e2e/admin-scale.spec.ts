import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generate, LARGE, serveScaleBackend } from './scaleBackend';
import { signIn } from './session';

/** The admin portal against a large RHU: every page must settle, page its lists, and not download what it never shows. */

const data = generate(LARGE);
const OUT = 'ui-report/scale';

const screens: Array<[string, string]> = [
  ['dashboard', '/admin'],
  ['residents', '/admin/residents'],
  ['inventory', '/admin/inventory'],
  ['accounts', '/admin/accounts'],
  ['health', '/admin/health'],
  ['analytics', '/admin/analytics'],
  ['reports', '/admin/reports'],
];

test.describe('admin portal at scale', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  test.setTimeout(120_000);

  for (const [name, path] of screens) {
    test(name, async ({ page }) => {
      await signIn(page, { role: 'admin', userId: 'rhu-1' });
      const traffic = await serveScaleBackend(page, data, { userId: 'rhu-1', role: 'admin', barangayId: null });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      const started = Date.now();
      await page.goto(path);
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
      await page.waitForLoadState('networkidle');
      const settledMs = Date.now() - started;
      const domNodes = await page.evaluate(() => document.querySelectorAll('*').length);

      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      writeFileSync(
        `${OUT}/${name}.json`,
        JSON.stringify({ settledMs, domNodes, requests: traffic.requests, megabytes: +(traffic.bytes / 1e6).toFixed(2), urls: traffic.urls }, null, 2),
      );

      expect(errors).toEqual([]);
    });
  }

  test('a search matching thousands of households still pages', async ({ page }) => {
    await signIn(page, { role: 'admin', userId: 'rhu-1' });
    await serveScaleBackend(page, data, { userId: 'rhu-1', role: 'admin', barangayId: null });
    await page.goto('/admin/residents');
    await page.getByLabel('Search residents').fill('HH-0');

    await expect(page.getByText(/Showing 10 of [\d,]{5,} residents/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/could not/i)).toHaveCount(0);
  });

  test('exports the resident list, reading names only then', async ({ page }) => {
    await signIn(page, { role: 'admin', userId: 'rhu-1' });
    const traffic = await serveScaleBackend(page, data, { userId: 'rhu-1', role: 'admin', barangayId: null });
    // The dialog is the browser's; stand in for it closing.
    await page.addInitScript(() => {
      window.print = () => {
        (window as unknown as { printedRows: number }).printedRows = document.querySelectorAll('.print-report tbody tr').length;
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    await page.goto('/admin/reports');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });

    expect(traffic.urls.some((url) => url.includes('first_name'))).toBe(false);
    await expect(page.locator('.print-report')).toHaveCount(0);

    await page.getByLabel('Report to export').selectOption('residents');
    await page.getByRole('button', { name: 'Export report' }).click();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { printedRows?: number }).printedRows), { timeout: 60_000 })
      .toBeGreaterThan(20_000);
    await expect(page.locator('.print-report')).toHaveCount(0);
  });
});
