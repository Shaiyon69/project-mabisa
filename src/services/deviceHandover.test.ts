import { beforeEach, describe, expect, it, vi } from 'vitest';

// A handover is a row count and a wipe, both in localDatabase. The decision under
// test is which of them runs, so they are stubbed and asserted on.
const counts = vi.hoisted(() => ({ sync_queue: 0, sync_dead_letter: 0 }) as Record<string, number>);
const cleared = vi.hoisted(() => ({ records: 0 }));
// The purok the server would file this worker's records under. `null` stands for a
// phone that could not reach it.
const server = vi.hoisted(() => ({ purokId: null as string | null }));

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: () => Promise.resolve({ data: server.purokId, error: null }) },
}));

vi.mock('./localDatabase', () => ({
  countRows: (table: string) => Promise.resolve(counts[table] ?? 0),
  clearLocalRecords: () => {
    cleared.records += 1;
    return Promise.resolve();
  },
}));

// Vitest runs this in plain Node, which has no `localStorage`. Own properties as
// well as a Map, since the draft sweep enumerates the keys.
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
const PUROK_2 = 'purok-2-id';
const PUROK_3 = 'purok-3-id';

beforeEach(() => {
  localStorage.clear();
  counts.sync_queue = 0;
  counts.sync_dead_letter = 0;
  cleared.records = 0;
  server.purokId = PUROK_2;
});

describe('claiming a device for an account', () => {
  it('claims a phone nobody has claimed, without touching the records', async () => {
    expect(await claimDeviceFor(ANA)).toEqual({ claimed: true });

    expect(localStorage.getItem(OWNER_KEY)).toBe(`${ANA}:${PUROK_2}`);
    expect(cleared.records).toBe(0);
  });

  // Signing in again after an expired token takes this path, and its unsent
  // records must survive it.
  it('lets the same account back in with records still waiting', async () => {
    localStorage.setItem(OWNER_KEY, `${ANA}:${PUROK_2}`);
    counts.sync_queue = 7;

    expect(await claimDeviceFor(ANA)).toEqual({ claimed: true });
    expect(cleared.records).toBe(0);
  });

  it('empties the previous purok when nothing is waiting to send', async () => {
    localStorage.setItem(OWNER_KEY, `${ANA}:${PUROK_2}`);
    localStorage.setItem('mabisa.pulled_through', '2026-08-30T00:00:00.000Z');
    localStorage.setItem('mabisa.last_sync_at', '2026-08-30T01:00:00.000Z');

    expect(await claimDeviceFor(ROSA)).toEqual({ claimed: true });

    expect(cleared.records).toBe(1);
    expect(localStorage.getItem(OWNER_KEY)).toBe(`${ROSA}:${PUROK_2}`);
    // Kept, the next pull reads only what changed since Ana's sync and Rosa opens an empty purok.
    expect(localStorage.getItem('mabisa.pulled_through')).toBeNull();
    expect(localStorage.getItem('mabisa.last_sync_at')).toBeNull();
  });

  // A saved draft is an unfinished visit that never reached the queue, and the
  // handover deletes every draft on the phone.
  it('refuses while the previous account has an unfinished household draft', async () => {
    localStorage.setItem(OWNER_KEY, `${ANA}:${PUROK_2}`);
    localStorage.setItem(`mabisa.household_draft.${ANA}`, '{"members":[{}]}');

    expect(await claimDeviceFor(ROSA)).toEqual({ claimed: false, unsent: 1, heldBy: 'worker' });

    expect(cleared.records).toBe(0);
    expect(localStorage.getItem(OWNER_KEY)).toBe(`${ANA}:${PUROK_2}`);
    expect(localStorage.getItem(`mabisa.household_draft.${ANA}`)).not.toBeNull();
  });

  it('refuses while the previous account still has records on the queue', async () => {
    localStorage.setItem(OWNER_KEY, `${ANA}:${PUROK_2}`);
    counts.sync_queue = 3;

    expect(await claimDeviceFor(ROSA)).toEqual({ claimed: false, unsent: 3, heldBy: 'worker' });

    // Nothing moved: the records stay, and so does the account that can send them.
    expect(cleared.records).toBe(0);
    expect(localStorage.getItem(OWNER_KEY)).toBe(`${ANA}:${PUROK_2}`);
  });

  // A quarantined record has not reached the server either.
  it('counts the dead letter as waiting', async () => {
    localStorage.setItem(OWNER_KEY, `${ANA}:${PUROK_2}`);
    counts.sync_dead_letter = 2;

    expect(await claimDeviceFor(ROSA)).toEqual({ claimed: false, unsent: 2, heldBy: 'worker' });
    expect(cleared.records).toBe(0);
  });

  // Without this the old purok's households stay in SQLite, and both BHW forms
  // search them: a visit recorded against a resident this worker no longer covers.
  it('empties the phone when the same worker is moved to another purok', async () => {
    localStorage.setItem(OWNER_KEY, `${ANA}:${PUROK_2}`);
    server.purokId = PUROK_3;

    expect(await claimDeviceFor(ANA)).toEqual({ claimed: true });

    expect(cleared.records).toBe(1);
    expect(localStorage.getItem(OWNER_KEY)).toBe(`${ANA}:${PUROK_3}`);
  });

  // Draining them would file them under the new purok: the household insert trigger
  // stamps the writer's current one, not the one they were recorded in.
  it('refuses a purok move while the old purok has records waiting', async () => {
    localStorage.setItem(OWNER_KEY, `${ANA}:${PUROK_2}`);
    server.purokId = PUROK_3;
    counts.sync_queue = 4;

    expect(await claimDeviceFor(ANA)).toEqual({ claimed: false, unsent: 4, heldBy: 'purok' });

    expect(cleared.records).toBe(0);
    expect(localStorage.getItem(OWNER_KEY)).toBe(`${ANA}:${PUROK_2}`);
  });

  // Offline, so the move cannot be seen. Holding her own records is the safe
  // direction — the check runs again on the next sign-in with a connection.
  it('lets the same worker in when the purok cannot be read', async () => {
    localStorage.setItem(OWNER_KEY, `${ANA}:${PUROK_2}`);
    server.purokId = null;
    counts.sync_queue = 5;

    expect(await claimDeviceFor(ANA)).toEqual({ claimed: true });

    expect(cleared.records).toBe(0);
    expect(localStorage.getItem(OWNER_KEY)).toBe(`${ANA}:${PUROK_2}`);
  });

  // A key from before the purok was part of it. Upgraded in place rather than read
  // as a move, which would wipe a phone that has not gone anywhere.
  it('records the purok on a key that predates it', async () => {
    localStorage.setItem(OWNER_KEY, ANA);
    counts.sync_queue = 6;

    expect(await claimDeviceFor(ANA)).toEqual({ claimed: true });

    expect(cleared.records).toBe(0);
    expect(localStorage.getItem(OWNER_KEY)).toBe(`${ANA}:${PUROK_2}`);
  });
});
