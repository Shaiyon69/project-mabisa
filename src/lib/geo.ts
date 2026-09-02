import boundaries from '../data/barangay-boundaries.json';
import { logDev } from './utils';

/**
 * Barangay outlines, and the projection that turns them into SVG paths. The
 * boundary data is bundled rather than fetched, and projecting a handful of
 * polygons into a viewBox is the code below, so there is no mapping library here.
 *
 * `src/data/barangay-boundaries.json` ships empty: it is deployment data, like
 * VITE_BARANGAY_NAME, and only the LGU knows which municipality an install covers.
 */

type Position = [number, number];
type Ring = Position[];

type GeoFeature = {
  type: string;
  properties?: Record<string, unknown> | null;
  geometry?: {
    type: string;
    coordinates: unknown;
  } | null;
};

/** One barangay outline, already reduced to the rings we draw. */
export type BarangayShape = {
  /** Lowercased match key, from `code` if present and `name` otherwise. */
  key: string;
  label: string;
  polygons: Ring[][];
};

/**
 * Normalises a barangay name or code, so a boundary file exported as
 * `Barangay Poblacion` still lines up with a `barangays.code` of `POBLACION`.
 */
export function boundaryKey(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^barangay\s+/, '')
    .replace(/\s+/g, ' ');
}

function ringsOf(geometry: NonNullable<GeoFeature['geometry']>): Ring[][] {
  // A Polygon is one ring set, a MultiPolygon a list of them. Normalised here, so
  // the renderer has one case.
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates as Ring[]];
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates as Ring[][];
  }

  return [];
}

export const barangayShapes: BarangayShape[] = ((boundaries as { features?: GeoFeature[] }).features ?? []).flatMap(
  (feature) => {
    const properties = feature.properties ?? {};
    const code = typeof properties.code === 'string' ? properties.code : null;
    const name = typeof properties.name === 'string' ? properties.name : null;
    const key = boundaryKey(code ?? name);
    const polygons = feature.geometry ? ringsOf(feature.geometry) : [];

    if (!key || !polygons.length) {
      logDev('Boundary feature skipped: no code/name or unsupported geometry', feature.geometry?.type);
      return [];
    }

    return [{ key, label: name ?? code ?? key, polygons }];
  },
);

export type Projection = {
  width: number;
  height: number;
  path: (polygons: Ring[][]) => string;
};

/**
 * An equirectangular fit of the given shapes to a fixed-width viewBox. Longitude
 * is scaled by cos(latitude) so a barangay is not stretched sideways; a real
 * conic projection buys nothing across a single municipality.
 *
 * Returns null when there is nothing to fit, so the caller renders its
 * "boundaries not supplied" state rather than dividing by a zero-width extent.
 */
export function fitProjection(shapes: BarangayShape[], width = 1000, padding = 8): Projection | null {
  const points = shapes.flatMap((shape) => shape.polygons.flat().flat());

  if (points.length < 3) {
    return null;
  }

  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const stretch = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)) || 1;

  const spanX = Math.max((maxLon - minLon) * stretch, Number.EPSILON);
  const spanY = Math.max(maxLat - minLat, Number.EPSILON);
  const scale = (width - padding * 2) / spanX;
  const height = spanY * scale + padding * 2;

  // Latitude grows northward and SVG y grows downward, hence maxLat - lat.
  const project = ([lon, lat]: Position): string =>
    `${(padding + (lon - minLon) * stretch * scale).toFixed(2)} ${(padding + (maxLat - lat) * scale).toFixed(2)}`;

  return {
    width,
    height,
    path: (polygons) =>
      polygons
        .flatMap((rings) => rings.map((ring) => `M${ring.map(project).join('L')}Z`))
        .join(''),
  };
}
