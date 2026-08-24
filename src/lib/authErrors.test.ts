import { describe, expect, it } from 'vitest';
import { describeAuthError } from './authErrors';

describe('describeAuthError', () => {
  it('says which part to re-check on a wrong password', () => {
    expect(describeAuthError('Invalid login credentials')).toContain('did not match');
  });

  // The one that mattered most: "Failed to fetch" does not tell a field worker
  // that the problem is the signal rather than their password.
  it('names the connection when the request never reached the server', () => {
    for (const raw of ['Failed to fetch', 'NetworkError when attempting to fetch resource', 'Load failed', 'TypeError: fetch failed']) {
      expect(describeAuthError(raw)).toContain('No connection');
    }
  });

  it('points at the administrator for an account that is not set up', () => {
    expect(describeAuthError('Email not confirmed')).toContain('administrator');
    expect(describeAuthError('User not found')).toContain('administrator');
  });

  it('says to wait when the attempts are being throttled', () => {
    expect(describeAuthError('Email rate limit exceeded')).toContain('Wait a few minutes');
  });

  it('matches whatever casing the client hands over', () => {
    expect(describeAuthError('INVALID LOGIN CREDENTIALS')).toBe(describeAuthError('invalid login credentials'));
  });

  // An unrecognised error must still leave the reader with something to do, and
  // must never be the raw string — that is the behaviour being replaced.
  it('falls back to an actionable sentence rather than the raw text', () => {
    const fallback = describeAuthError('AuthApiError: unexpected_failure (500)');

    expect(fallback).not.toContain('AuthApiError');
    expect(fallback).toContain('try again');
  });
});
