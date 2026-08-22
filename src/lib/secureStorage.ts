import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

/**
 * Key-value storage backed by the Android Keystore on a device, and by
 * `localStorage` in a browser.
 *
 * The split is not a convenience: there is no browser equivalent of a hardware
 * keystore, and the development build runs on `npm run dev` in Chrome. Pretending
 * otherwise would either break local development or claim a protection the web
 * build does not have. The same `getPlatform() === 'web'` test already decides
 * the SQLite web polyfill in `localDatabase.ts` and the `jeep-sqlite`
 * registration in `main.tsx`.
 */
const isWebPlatform = Capacitor.getPlatform() === 'web';

/**
 * Where the web branch actually writes.
 *
 * Vitest runs this module in plain Node, which has no `localStorage` — importing
 * `src/lib/supabase` there used to be harmless and would otherwise now throw from
 * inside the auth client's session load. A Map keeps that path working without
 * pretending anything is persisted.
 */
const memoryStore = new Map<string, string>();

function webStore(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/**
 * Async because the native side is. supabase-js accepts a promise-returning
 * storage adapter, which is what lets the refresh token live somewhere better
 * than `localStorage` without the client needing to know the difference.
 */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isWebPlatform) {
      return webStore()?.getItem(key) ?? memoryStore.get(key) ?? null;
    }

    try {
      return await SecureStorage.getItem(key);
    } catch {
      // A keystore read can fail on a device whose credentials were reset. Treat
      // it as "nothing stored" rather than throwing: the caller then signs in
      // again, which is recoverable, instead of the app failing to start.
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (isWebPlatform) {
      const store = webStore();

      if (store) {
        store.setItem(key, value);
      } else {
        memoryStore.set(key, value);
      }

      return;
    }

    await SecureStorage.setItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (isWebPlatform) {
      webStore()?.removeItem(key);
      memoryStore.delete(key);
      return;
    }

    try {
      await SecureStorage.removeItem(key);
    } catch {
      // Removing a key that is not there is not a failure worth propagating —
      // sign-out has to succeed regardless.
    }
  },
};

/**
 * A passphrase for the local database, generated once on the device it protects.
 *
 * 32 bytes from the platform CSPRNG. Deliberately not derived from anything a
 * person types or a build ships: a hardcoded key protects nothing, and a key
 * derived from the account password would make the database unreadable until the
 * BHW signs in — which breaks background sync after a cold start and orphans the
 * whole database the day the password changes.
 *
 * The caller hands this to `setEncryptionSecret()` exactly once. After that the
 * SQLite plugin holds it in the platform's own secure store and this is never
 * called again.
 */
export function generateDatabasePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
