import { expect, test, type Page } from '@playwright/test';
import { seedPin, signIn } from './session';

async function openApp(page: Page) {
  await signIn(page, { role: 'bhw', userId: 'bhw-1' });
  await seedPin(page, 'bhw-1', '2749');
  await page.goto('/bhw');
  await page.getByRole('dialog').locator('input.pin-input').fill('2749');
  await page.getByRole('dialog').getByRole('button').last().click();
  await expect(page.getByRole('navigation', { name: /sections/i })).toBeVisible();
}

/**
 * The bar used to float 12px off the bottom with fully rounded ends, which left a
 * live strip underneath it and open corners beside it. Anything scrolled into
 * that space stayed visible and kept taking taps.
 */
test.describe('the bottom navigation', () => {
  test('meets the bottom of the screen, leaving no strip under it', async ({ page }) => {
    await openApp(page);

    const nav = page.getByRole('navigation', { name: /sections/i });
    const box = (await nav.boundingBox())!;
    const viewport = page.viewportSize()!;

    expect(box).not.toBeNull();
    // Flush with the bottom edge, within a pixel of rounding.
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
  });

  test('meets both side edges, leaving no corner to reach past', async ({ page }) => {
    await openApp(page);

    const nav = page.getByRole('navigation', { name: /sections/i });
    const shell = page.locator('.bhw-mobile-shell');
    const navBox = (await nav.boundingBox())!;
    const shellBox = (await shell.boundingBox())!;

    expect(Math.abs(navBox.x - shellBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(navBox.width - shellBox.width)).toBeLessThanOrEqual(1);
  });

  test('takes the tap itself where a control has scrolled underneath it', async ({ page }) => {
    await openApp(page);

    const nav = page.getByRole('navigation', { name: /sections/i });
    const box = (await nav.boundingBox())!;

    // Every point across the bar's own band belongs to the bar or its links —
    // never to something that has scrolled beneath it.
    for (const ratio of [0.02, 0.25, 0.5, 0.75, 0.98]) {
      const x = box.x + box.width * ratio;

      for (const y of [box.y + 2, box.y + box.height / 2, box.y + box.height - 2]) {
        const owner = await page.evaluate(
          ([pointX, pointY]) => {
            const element = document.elementFromPoint(pointX as number, pointY as number);
            return element?.closest('.bhw-bottom-nav') ? 'nav' : (element?.className ?? 'none').toString();
          },
          [x, y] as const,
        );

        expect(owner, `point ${Math.round(x)},${Math.round(y)} should belong to the nav`).toBe('nav');
      }
    }
  });
});
