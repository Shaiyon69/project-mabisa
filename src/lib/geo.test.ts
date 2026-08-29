import { describe, expect, it } from 'vitest';
import { boundaryKey, fitProjection, type BarangayShape } from './geo';

describe('boundaryKey', () => {
  it('matches the same place written the several ways an export writes it', () => {
    // A boundary file from PhilGIS says "Barangay Poblacion"; the barangays row
    // says "POBLACION". Both sides go through this, so the map still lines up.
    expect(boundaryKey('Barangay Poblacion')).toBe('poblacion');
    expect(boundaryKey('POBLACION')).toBe('poblacion');
    expect(boundaryKey('  Pag-asa  ')).toBe('pag-asa');
    expect(boundaryKey(null)).toBe('');
  });
});

describe('fitProjection', () => {
  // A one-degree square, which makes every expected coordinate checkable by hand.
  const square: BarangayShape = {
    key: 'square',
    label: 'Square',
    polygons: [
      [
        [
          [120, 8],
          [121, 8],
          [121, 9],
          [120, 9],
          [120, 8],
        ],
      ],
    ],
  };

  it('returns null when there is nothing to draw', () => {
    // The shipped boundary file is empty, so this is the path a fresh install
    // takes — the caller renders its "no boundaries" state rather than dividing
    // by a zero-width extent.
    expect(fitProjection([])).toBeNull();
  });

  it('fits the shapes to the viewBox with north at the top', () => {
    const projection = fitProjection([square], 1000, 10);

    expect(projection).not.toBeNull();
    const path = projection!.path(square.polygons);

    // West edge at the left padding, east edge at width minus it.
    expect(path.startsWith('M10.00 ')).toBe(true);
    expect(path).toContain('990.00');

    // Latitude grows northward and SVG y grows downward: the northern edge
    // (lat 9) must project above the southern one (lat 8). Getting this
    // backwards flips every barangay on the map and still looks plausible.
    const ys = [...path.matchAll(/[ML]\d+\.\d+ (\d+\.\d+)/g)].map((match) => Number(match[1]));
    const northY = ys[2];
    const southY = ys[0];

    expect(northY).toBeLessThan(southY);
    expect(southY).toBeCloseTo(projection!.height - 10, 1);
  });

  it('keeps a square square rather than stretching it by longitude', () => {
    const projection = fitProjection([square], 1000, 0)!;

    // One degree of longitude is shorter than one of latitude away from the
    // equator, so an unscaled fit would draw this square noticeably wide.
    expect(projection.height).toBeGreaterThan(1000);
    expect(projection.height).toBeCloseTo(1000 / Math.cos(8.5 * (Math.PI / 180)), 0);
  });

  it('draws every ring of a multipolygon as its own closed subpath', () => {
    const projection = fitProjection([square], 1000, 0)!;
    const twoRings = projection.path([...square.polygons, ...square.polygons]);

    expect(twoRings.match(/Z/g)).toHaveLength(2);
  });
});
