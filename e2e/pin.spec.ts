import { expect, test, type Page } from '@playwright/test';
import { seedPin, signIn } from './session';

const gate = (page: Page) => page.getByRole('dialog');
const pinField = (page: Page) => page.getByRole('dialog').locator('input.pin-input');

async function enter(page: Page, pin: string) {
  await pinField(page).fill(pin);
  await page.getByRole('dialog').getByRole('button').last().click();
}

test.describe('the device PIN', () => {
  test('asks a device with no PIN to choose one before anything is shown', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-new' });

    await page.goto('/bhw');

    await expect(gate(page).getByText('Choose a PIN')).toBeVisible();
    // Nothing behind it is reachable while it stands.
    await expect(page.getByRole('navigation', { name: /sections/i })).toBeHidden();
  });

  test('turns down a PIN anyone would guess first', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-new' });
    await page.goto('/bhw');
    await expect(gate(page).getByText('Choose a PIN')).toBeVisible();

    await enter(page, '1111');
    await expect(gate(page).getByRole('alert')).toContainText('same digit');

    await enter(page, '1234');
    await expect(gate(page).getByRole('alert')).toContainText('in a row');
  });

  test('takes a PIN, confirms it, and opens the app', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-new' });
    await page.goto('/bhw');

    await enter(page, '2749');
    await expect(gate(page).getByText('Enter it again')).toBeVisible();

    await enter(page, '2749');
    await expect(page.getByRole('navigation', { name: /sections/i })).toBeVisible();
    await expect(gate(page)).toBeHidden();
  });

  test('makes a mismatched confirmation start over rather than saving either one', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-new' });
    await page.goto('/bhw');

    await enter(page, '2749');
    await enter(page, '2748');

    await expect(gate(page).getByRole('alert')).toContainText('did not match');
    await expect(gate(page).getByText('Choose a PIN')).toBeVisible();
  });

  test('asks for the PIN on a cold start, so a force-quit is not a way past it', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-1' });
    await seedPin(page, 'bhw-1', '2749');

    await page.goto('/bhw');

    await expect(gate(page).getByText('Enter your PIN')).toBeVisible();
    await expect(page.getByRole('navigation', { name: /sections/i })).toBeHidden();
  });

  test('opens for the right PIN and refuses the wrong one', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-1' });
    await seedPin(page, 'bhw-1', '2749');
    await page.goto('/bhw');
    await expect(gate(page).getByText('Enter your PIN')).toBeVisible();

    await enter(page, '2748');
    await expect(gate(page).getByRole('alert')).toContainText('not right');
    await expect(page.getByRole('navigation', { name: /sections/i })).toBeHidden();

    await enter(page, '2749');
    await expect(page.getByRole('navigation', { name: /sections/i })).toBeVisible();
  });

  test('says the records are still here, so a locked screen never reads as lost work', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-1' });
    await seedPin(page, 'bhw-1', '2749');

    await page.goto('/bhw');

    await expect(gate(page)).toContainText(/still on this device|still saved on this device/);
  });

  test('never puts the digits on screen', async ({ page }) => {
    await signIn(page, { role: 'bhw', userId: 'bhw-1' });
    await seedPin(page, 'bhw-1', '2749');
    await page.goto('/bhw');
    await expect(gate(page).getByText('Enter your PIN')).toBeVisible();

    await pinField(page).fill('2749');

    await expect(pinField(page)).toHaveAttribute('type', 'password');
    await expect(gate(page)).not.toContainText('2749');
  });
});
