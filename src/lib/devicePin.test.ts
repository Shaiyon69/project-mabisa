import { describe, expect, it } from 'vitest';
import { PIN_LENGTH, clearPin, delayAfter, describeWait, describeWeakPin, isPinSet, setPin, verifyPin } from './devicePin';
import { secureStorage } from './secureStorage';

// Each test uses its own account id: the store is shared for the file, and a
// PIN is keyed per account precisely so two workers on one phone can't collide.
let nextUser = 0;
const someone = () => `user-${(nextUser += 1)}`;

describe('describeWeakPin', () => {
  it('accepts an ordinary PIN', () => {
    expect(describeWeakPin('2749')).toBeNull();
  });

  it('insists on exactly the right number of digits', () => {
    expect(describeWeakPin('274')).toContain(`${PIN_LENGTH} digits`);
    expect(describeWeakPin('27491')).toContain(`${PIN_LENGTH} digits`);
    expect(describeWeakPin('')).not.toBeNull();
    expect(describeWeakPin('27a9')).not.toBeNull();
  });

  // Four digits is only 10,000 possibilities; these are the ones someone
  // standing over the phone would actually try first.
  it('turns down the handful a person would guess by hand', () => {
    expect(describeWeakPin('1111')).toContain('same digit');
    expect(describeWeakPin('0000')).toContain('same digit');
    expect(describeWeakPin('1234')).toContain('in a row');
    expect(describeWeakPin('4321')).toContain('in a row');
    expect(describeWeakPin('6789')).toContain('in a row');
  });
});

describe('setting and checking a PIN', () => {
  it('opens for the right PIN and refuses the wrong one', async () => {
    const user = someone();
    await setPin(user, '2749');

    expect(await isPinSet(user)).toBe(true);
    expect(await verifyPin(user, '2749')).toEqual({ ok: true });
    expect(await verifyPin(user, '2748')).toMatchObject({ ok: false, reason: 'wrong' });
  });

  it('never writes the PIN itself', async () => {
    const user = someone();
    await setPin(user, '2749');

    const stored = await secureStorage.getItem(`mabisa.device_pin.${user}`);

    expect(stored).not.toBeNull();
    expect(stored).not.toContain('2749');
    // A salt and a derived hash, not the digits.
    expect(JSON.parse(stored!)).toMatchObject({
      salt: expect.any(String),
      hash: expect.any(String),
      iterations: expect.any(Number),
    });
  });

  it('salts per account, so the same PIN on one phone does not look the same twice', async () => {
    const first = someone();
    const second = someone();
    await setPin(first, '2749');
    await setPin(second, '2749');

    const read = async (user: string) => JSON.parse((await secureStorage.getItem(`mabisa.device_pin.${user}`))!);

    expect((await read(first)).salt).not.toBe((await read(second)).salt);
    expect((await read(first)).hash).not.toBe((await read(second)).hash);
  });

  it('refuses to store a PIN it would have turned down', async () => {
    await expect(setPin(someone(), '1111')).rejects.toThrow(/same digit/);
  });

  it('answers no-pin rather than throwing when none was ever set', async () => {
    const user = someone();

    expect(await isPinSet(user)).toBe(false);
    expect(await verifyPin(user, '2749')).toEqual({ ok: false, reason: 'no-pin' });
  });

  it('forgets the PIN on sign-out, so the next person sets their own', async () => {
    const user = someone();
    await setPin(user, '2749');
    await clearPin(user);

    expect(await isPinSet(user)).toBe(false);
  });
});

describe('the wait after wrong entries', () => {
  it('costs nothing for a mistyped digit, then backs off to a cap', () => {
    expect(delayAfter(1)).toBe(0);
    expect(delayAfter(4)).toBe(0);
    expect(delayAfter(5)).toBe(30_000);
    expect(delayAfter(6)).toBe(60_000);
    expect(delayAfter(7)).toBe(120_000);
    // Capped, and never a permanent lockout — this phone may hold the only copy
    // of a day's records, and a health worker shut out of them is the worse outcome.
    expect(delayAfter(99)).toBe(15 * 60_000);
    expect(delayAfter(99)).toBeLessThan(Infinity);
  });

  it('starts refusing entries once the wait is running, without checking the PIN', async () => {
    const user = someone();
    await setPin(user, '2749');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await verifyPin(user, '0000', 1_000);
    }

    // Still inside the wait: even the correct PIN is turned away.
    expect(await verifyPin(user, '2749', 1_000)).toMatchObject({ ok: false, reason: 'waiting' });

    // And once it has passed, the right PIN works again.
    expect(await verifyPin(user, '2749', 1_000 + 30_001)).toEqual({ ok: true });
  });

  it('clears the count on a correct entry', async () => {
    const user = someone();
    await setPin(user, '2749');

    // Four wrong entries — the last one still free, so nothing is waiting yet.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await verifyPin(user, '0000')).toEqual({ ok: false, reason: 'wrong', waitMs: 0 });
    }

    expect(await verifyPin(user, '2749')).toEqual({ ok: true });

    // The next wrong entry starts from zero rather than being the fifth in a
    // row, so it costs nothing. Without the reset this would already be a wait.
    expect(await verifyPin(user, '0000')).toEqual({ ok: false, reason: 'wrong', waitMs: 0 });
  });
});

describe('describeWait', () => {
  it('counts in whatever unit reads faster', () => {
    expect(describeWait(30_000)).toContain('30 second');
    expect(describeWait(120_000)).toContain('2 minute');
  });
});
