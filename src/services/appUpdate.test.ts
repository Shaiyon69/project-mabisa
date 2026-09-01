import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './appUpdate';

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
