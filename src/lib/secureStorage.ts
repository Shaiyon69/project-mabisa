import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

/**
 * Key-value storage backed by the Android Keystore on a device, and by
 * `localStorage` in a browser — there's no browser equivalent of a hardware
 * keystore, so pretending otherwise would claim a protection the web build
 * doesn't have. Same `getPlatform() === 'web'` test as localDatabase.ts and main.tsx.
 */
const isWebPlatform = Capacitor.getPlatform() === 'web';

/** Vitest runs this module in plain Node, which has no `localStorage` — a Map keeps that path working without pretending anything is persisted. */
const memoryStore = new Map<string, string>();

function webStore(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/** Async because the native side is — lets the refresh token live somewhere better than `localStorage` without the client knowing the difference. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isWebPlatform) {
      return webStore()?.getItem(key) ?? memoryStore.get(key) ?? null;
    }

    try {
      return await SecureStorage.getItem(key);
    } catch {
      // A keystore read can fail after a credential reset — treat as "nothing stored" so the app can recover by re-signing-in.
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
 * A passphrase for the local database, generated once on the device it protects —
 * 32 bytes from the platform CSPRNG. Not derived from the account password: that
 * would make the database unreadable until sign-in and orphan it if the password changes.
 */
export function generateDatabasePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
