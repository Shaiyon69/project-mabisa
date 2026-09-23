import { describe, expect, it } from 'vitest';
import { FREE_ATTEMPTS, describeWait, lockRemaining, recordFailure, recordSuccess, type ThrottleState } from './loginThrottle';

function failTimes(count: number, email = 'bhw@example.test', now = 0): ThrottleState {
  let state: ThrottleState = {};

  for (let i = 0; i < count; i += 1) {
    state = recordFailure(state, email, now);
  }

  return state;
}

describe('login throttle', () => {
  it('allows the free attempts without a lock', () => {
    expect(lockRemaining(failTimes(FREE_ATTEMPTS), 'bhw@example.test', 0)).toBe(0);
  });

  it('locks for 30 seconds on the first attempt past the limit, doubling after', () => {
    expect(lockRemaining(failTimes(FREE_ATTEMPTS + 1), 'bhw@example.test', 0)).toBe(30_000);
    expect(lockRemaining(failTimes(FREE_ATTEMPTS + 2), 'bhw@example.test', 0)).toBe(60_000);
    expect(lockRemaining(failTimes(FREE_ATTEMPTS + 3), 'bhw@example.test', 0)).toBe(120_000);
  });

  it('caps the lock at 15 minutes', () => {
    expect(lockRemaining(failTimes(FREE_ATTEMPTS + 20), 'bhw@example.test', 0)).toBe(15 * 60_000);
  });

  it('runs out once the time has passed', () => {
    expect(lockRemaining(failTimes(FREE_ATTEMPTS + 1), 'bhw@example.test', 30_000)).toBe(0);
  });

  it('counts per address, ignoring case and surrounding spaces', () => {
    const state = failTimes(FREE_ATTEMPTS + 1, ' BHW@Example.test ');

    expect(lockRemaining(state, 'bhw@example.test', 0)).toBe(30_000);
    expect(lockRemaining(state, 'other@example.test', 0)).toBe(0);
  });

  it('starts the count over after a day without a failure', () => {
    const state = recordFailure(failTimes(FREE_ATTEMPTS), 'bhw@example.test', 25 * 60 * 60_000);

    expect(lockRemaining(state, 'bhw@example.test', 25 * 60 * 60_000)).toBe(0);
  });

  it('clears the count on success', () => {
    const state = recordSuccess(failTimes(FREE_ATTEMPTS + 1), 'bhw@example.test');

    expect(lockRemaining(state, 'bhw@example.test', 0)).toBe(0);
    expect(lockRemaining(recordFailure(state, 'bhw@example.test', 0), 'bhw@example.test', 0)).toBe(0);
  });

  it('describes a wait rounded up', () => {
    expect(describeWait(1)).toBe('1 second');
    expect(describeWait(29_001)).toBe('30 seconds');
    expect(describeWait(60_001)).toBe('2 minutes');
  });
});
