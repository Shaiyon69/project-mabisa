import { expect, test } from '@playwright/test';
import { seedPin, signIn } from './session';

/**
 * The bug this covers: signing out left the address bar on an /admin path, so
 * the next person to sign in on the device was dropped there. A health worker
 * then met a notice about being in the wrong place instead of their own screens.
 */
test.describe('which surface a session lands on', () => {
  test('sends a health worker who lands on an admin path to their own screens', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-1' });
    await seedPin(page, 'bhw-1', '2749');

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/bhw$/);
    await expect(page.getByText('This is the BRHP-MSAM admin portal')).toBeHidden();
  });

  test('sends them on from a deep admin path too, not just the index', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-1' });
    await seedPin(page, 'bhw-1', '2749');

    await page.goto('/admin/reports');

    await expect(page).toHaveURL(/\/bhw$/);
  });

  test('leaves an administrator on the portal', async ({ page }) => {
    await signIn(page, { role: 'barangay_admin', userId: 'admin-1' });

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin$/);
  });

  test('does not bounce an administrator out while their role is still being read', async ({ page }) => {
    // No cached role, and the profile call held open: this is the window where
    // the app knows there is a session but not yet whose.
    await signIn(page, { role: 'admin', userId: 'admin-2', cacheRole: false });
    await page.route('**/rest/v1/profiles*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ role: 'admin', is_active: true }),
      });
    });

    await page.goto('/admin');

    // Held, not redirected — an unanswered lookup is not the same as "not an admin".
    await expect(page.getByText('Checking your account')).toBeVisible();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page).toHaveURL(/\/admin$/, { timeout: 5000 });
  });
});
