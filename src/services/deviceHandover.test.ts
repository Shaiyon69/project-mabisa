import { beforeEach, describe, expect, it, vi } from 'vitest';

// The two things a handover actually does are a row count and a wipe; both live
// in localDatabase, which needs a SQLite engine to say anything. The decision
// under test is which of them runs, so they are stubbed and asserted on.
const counts = vi.hoisted(() => ({ sync_queue: 0, sync_dead_letter: 0 }) as Record<string, number>);
const cleared = vi.hoisted(() => ({ records: 0 }));

vi.mock('./localDatabase', () => ({
  countRows: (table: string) => Promise.resolve(counts[table] ?? 0),
  clearLocalRecords: () => {
    cleared.records += 1;
    return Promise.resolve();
  },
}));

// Vitest runs this in plain Node, which has no `localStorage`. Own properties as
// well as a Map, because the draft sweep enumerates the keys.
const stub = {
  getItem: (key: string): string | null => (key in values ? values[key] : null),
  setItem: (key: string, value: string) => {
    values[key] = value;
  },
  removeItem: (key: string) => {
    delete values[key];
  },
  clear: () => {
    for (const key of Object.keys(values)) {
      delete values[key];
    }
  },
};
const values: Record<string, string> = {};

Object.defineProperty(globalThis, 'localStorage', {
  value: new Proxy(stub, {
    ownKeys: () => Object.keys(values),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  }),
  configurable: true,
});

const { claimDeviceFor } = await import('./deviceHandover');

const OWNER_KEY = 'mabisa.device_owner';
const ANA = 'ana-user-id';
const ROSA = 'rosa-user-id';

beforeEach(() => {
  localStorage.clear();
  counts.sync_queue = 0;
  counts.sync_dead_letter = 0;
  cleared.records = 0;
});

describe('claiming a device for an account', () => {
  it('claims a phone nobody has claimed, without touching the records', async () => {
    expect(await claimDeviceFor(ANA)).toEqual({ claimed: true });

    expect(localStorage.getItem(OWNER_KEY)).toBe(ANA);
    expect(cleared.records).toBe(0);
  });

  // Signing in again after an expired token is this path, and it is why the
  // check is here rather than on sign-out: those unsent records must survive it.
  it('lets the same account back in with records still waiting', async () => {
    localStorage.setItem(OWNER_KEY, ANA);
    counts.sync_queue = 7;

    expect(await claimDeviceFor(ANA)).toEqual({ claimed: true });
    expect(cleared.records).toBe(0);
  });

  it('empties the previous purok when nothing is waiting to send', async () => {
    localStorage.setItem(OWNER_KEY, ANA);
    localStorage.setItem('mabisa.pulled_through', '2026-08-30T00:00:00.000Z');
    localStorage.setItem('mabisa.last_sync_at', '2026-08-30T01:00:00.000Z');

    expect(await claimDeviceFor(ROSA)).toEqual({ claimed: true });

    expect(cleared.records).toBe(1);
    expect(localStorage.getItem(OWNER_KEY)).toBe(ROSA);
    // Kept, the next pull reads only what changed since Ana's sync and Rosa opens an empty purok.
    expect(localStorage.getItem('mabisa.pulled_through')).toBeNull();
    expect(localStorage.getItem('mabisa.last_sync_at')).toBeNull();
  });

  // A saved draft is an unfinished visit that never reached the queue, and the
  // handover deletes every draft on the phone. Counting it is what stops the wipe.
  it('refuses while the previous account has an unfinished household draft', async () => {
    localStorage.setItem(OWNER_KEY, ANA);
    localStorage.setItem(`mabisa.household_draft.${ANA}`, '{"members":[{}]}');

    expect(await claimDeviceFor(ROSA)).toEqual({ claimed: false, unsent: 1 });

    expect(cleared.records).toBe(0);
    expect(localStorage.getItem(OWNER_KEY)).toBe(ANA);
    expect(localStorage.getItem(`mabisa.household_draft.${ANA}`)).not.toBeNull();
  });

  it('refuses while the previous account still has records on the queue', async () => {
    localStorage.setItem(OWNER_KEY, ANA);
    counts.sync_queue = 3;

    expect(await claimDeviceFor(ROSA)).toEqual({ claimed: false, unsent: 3 });

    // Nothing moved: the records stay, and so does the account that can send them.
    expect(cleared.records).toBe(0);
    expect(localStorage.getItem(OWNER_KEY)).toBe(ANA);
  });

  // A quarantined record has not reached the server either. Wiping it is the one
  // way this app loses a household for good.
  it('counts the dead letter as waiting', async () => {
    localStorage.setItem(OWNER_KEY, ANA);
    counts.sync_dead_letter = 2;

    expect(await claimDeviceFor(ROSA)).toEqual({ claimed: false, unsent: 2 });
    expect(cleared.records).toBe(0);
  });
});
