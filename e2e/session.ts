import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/**
 * Signs a browser in without an account.
 *
 * The app reads its session out of storage (see `secureStorage`, which is
 * `localStorage` on the web build) and asks Supabase once for the signed-in
 * account's role. Seeding the first and stubbing the second gives every test a
 * deterministic session with no credentials in the repo and no network — which
 * is also the state this app is designed to run in.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? readEnvFile('VITE_SUPABASE_URL');

/** Supabase keys its stored session by the project ref — the first label of the API host. */
function storageKey(): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

function readEnvFile(name: string): string {
  // Read from .env rather than hardcoded: the value is not a secret (it ships in
  // the client bundle) but it belongs to the developer's environment, not to this file.
  const contents = readFileSync('.env', 'utf8');
  const line = contents.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));

  if (!line) {
    throw new Error(`${name} is not set — copy .env.example to .env before running the e2e suite.`);
  }

  return line.slice(name.length + 1).trim();
}

export type Role = 'admin' | 'barangay_admin' | 'bhw';

export type SignInOptions = {
  role: Role;
  userId?: string;
  /** Seeds the role cache the app reads synchronously at mount, as a returning device would have. */
  cacheRole?: boolean;
};

export async function signIn(page: Page, { role, userId = `user-${role}`, cacheRole = true }: SignInOptions) {
  // An hour out, so supabase-js treats the session as current and never tries to refresh it.
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;

  const session = {
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${userId}@example.test`,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };

  await page.addInitScript(
    ([key, value, cacheKey, cached]) => {
      window.localStorage.setItem(key as string, value as string);

      if (cached) {
        window.localStorage.setItem(cacheKey as string, cached as string);
      }
    },
    [
      storageKey(),
      JSON.stringify(session),
      'mabisa.user_role',
      cacheRole ? JSON.stringify({ userId, role }) : '',
    ] as const,
  );

  // Everything Supabase would be asked for. The app is offline-first, so a
  // refused call is a state it already handles; letting these reach the network
  // would make the suite depend on a live project.
  //
  // Registered before the profiles stub on purpose: a later route wins in
  // Playwright, so a catch-all added last would swallow the profile lookup and
  // every session would resolve to no role at all.
  await page.route('**/rest/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  // The one call the shell makes before deciding which surface a session belongs
  // to. An array of one row serves both callers: `.maybeSingle()` takes the row
  // out of it, and the portal's account list reads it as a one-account table.
  await page.route('**/rest/v1/profiles*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ user_id: userId, role, is_active: true, full_name: 'Test Account', barangay_id: null }]),
    }),
  );
}

/** Puts a known PIN on the device for the signed-in account, as a second run of the app would find. */
export async function seedPin(page: Page, userId: string, pin: string) {
  await page.addInitScript(
    async ([key, value]) => {
      const encoder = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const material = await crypto.subtle.importKey('raw', encoder.encode(value as string), 'PBKDF2', false, [
        'deriveBits',
      ]);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
        material,
        256,
      );
      const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

      window.localStorage.setItem(
        key as string,
        JSON.stringify({ salt: hex(salt), hash: hex(new Uint8Array(bits)), iterations: 310_000 }),
      );
    },
    [`mabisa.device_pin.${userId}`, pin] as const,
  );
}
