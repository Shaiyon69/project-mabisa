import { describe, expect, it } from 'vitest';
import { axisTicks, niceMax } from './charts';

describe('niceMax', () => {
  it('never returns zero, so an empty chart still has a scale', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-4)).toBe(1);
  });

  it('rounds up to a number a person would say out loud', () => {
    expect(niceMax(1)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(240)).toBe(250);
    expect(niceMax(600)).toBe(1000);
  });

  it('is never below the value it is scaling, or a bar would overflow its track', () => {
    for (const value of [1, 3, 9, 17, 44, 99, 101, 3333]) {
      expect(niceMax(value)).toBeGreaterThanOrEqual(value);
    }
  });
});

describe('axisTicks', () => {
  it('splits a scale of one into two ticks rather than five that repeat', () => {
    expect(axisTicks(1)).toEqual([0, 1]);
  });

  it('uses quarters when they come out whole', () => {
    expect(axisTicks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(axisTicks(1000)).toEqual([0, 250, 500, 750, 1000]);
  });

  it('drops to fewer divisions rather than label a fraction', () => {
    expect(axisTicks(25)).toEqual([0, 25]);
    expect(axisTicks(2)).toEqual([0, 1, 2]);
  });

  it('labels whole numbers ending at the top of the scale, for every scale niceMax produces', () => {
    for (const value of [0, 1, 3, 9, 17, 23, 44, 99, 101, 600, 3333]) {
      const max = niceMax(value);
      const ticks = axisTicks(max);

      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBe(max);
      expect(ticks.every(Number.isInteger)).toBe(true);
      expect(new Set(ticks).size).toBe(ticks.length);
    }
  });
});
