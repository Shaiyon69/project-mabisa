import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

/**
 * Key-value storage backed by the Android Keystore on a device and by
 * `localStorage` in a browser, which has no hardware keystore to offer.
 */
const isWebPlatform = Capacitor.getPlatform() === 'web';

/** Vitest runs this in plain Node, which has no `localStorage`, so a Map stands in. */
const memoryStore = new Map<string, string>();

function webStore(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/** Async because the native side is, so callers do not know which backing store they got. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isWebPlatform) {
      return webStore()?.getItem(key) ?? memoryStore.get(key) ?? null;
    }

    try {
      return await SecureStorage.getItem(key);
    } catch {
      // A keystore read can fail after a credential reset. Treated as nothing
      // stored, so the app recovers by signing in again.
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
      // Removing a key that is not there is not a failure: sign-out must succeed.
    }
  },
};

/**
 * A passphrase for the local database, 32 bytes from the platform CSPRNG,
 * generated once on the device it protects. Not derived from the account
 * password, which would orphan the database when that password changes.
 */
export function generateDatabasePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
