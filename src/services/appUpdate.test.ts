import { describe, expect, it } from 'vitest';
import { isBelowMinimum, isNewerVersion } from './appUpdate';

describe('isNewerVersion', () => {
  it('compares segments as numbers, not text', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false);
  });

  it('tolerates the v prefix on either side', () => {
    expect(isNewerVersion('v1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('v1.0.0', 'v1.0.0')).toBe(false);
  });

  it('treats a missing trailing segment as zero', () => {
    expect(isNewerVersion('1.0.1', '1.0')).toBe(true);
    expect(isNewerVersion('1.0', '1.0.0')).toBe(false);
  });

  it('reports no update for the same version', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
  });

  it('reports no update for a tag it cannot read', () => {
    expect(isNewerVersion('nightly', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0-rc1', '1.0.0')).toBe(false);
    expect(isNewerVersion('', '1.0.0')).toBe(false);
  });
});

describe('isBelowMinimum', () => {
  it('flags a build older than the declared minimum', () => {
    expect(isBelowMinimum('Fixes.\n\nmin-version: 1.1.20\n', '1.1.19')).toBe(true);
    expect(isBelowMinimum('min-version: v1.1.20', '1.1.20')).toBe(false);
    expect(isBelowMinimum('min-version: 1.1.20', '1.1.21')).toBe(false);
  });

  it('requires nothing when the body declares no minimum', () => {
    expect(isBelowMinimum(undefined, '1.0.0')).toBe(false);
    expect(isBelowMinimum('', '1.0.0')).toBe(false);
    expect(isBelowMinimum('min-version: soon', '1.0.0')).toBe(false);
  });
});
