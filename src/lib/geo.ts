import boundaries from '../data/barangay-boundaries.json';
import { logDev } from './utils';

/**
 * Barangay outlines, and the projection that turns them into SVG paths.
 *
 * The boundary data is imported rather than fetched: an LGU portal is online,
 * but a bundled file has no host to be down, no CORS to configure and no tile
 * server to pay for. It is also the whole reason there is no mapping library
 * here — projecting a handful of barangay polygons into a viewBox is the twenty
 * lines below, and Leaflet or MapLibre would add hundreds of kilobytes plus a
 * basemap request to draw shapes we already have the coordinates for.
 *
 * `src/data/barangay-boundaries.json` ships empty. It is deployment data, like
 * VITE_BARANGAY_NAME: only the LGU knows which municipality this install covers,
 * and inventing plausible-looking outlines would put a map on an official screen
 * that is confidently in the wrong place.
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
 * `Barangay Poblacion` and `POBLACION` are the same place. Both sides of the
 * match go through this, so a boundary file exported with the prefix still
 * lines up with a `barangays.code` recorded without it.
 */
export function boundaryKey(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^barangay\s+/, '')
    .replace(/\s+/g, ' ');
}

function ringsOf(geometry: NonNullable<GeoFeature['geometry']>): Ring[][] {
  // A Polygon is one ring set; a MultiPolygon is a list of them. Normalising to
  // the list shape here means the renderer has one case instead of two.
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
 * An equirectangular fit of the given shapes to a fixed-width viewBox.
 *
 * Longitude is scaled by cos(latitude) so a barangay is not stretched sideways —
 * at 8–18°N that is a 1–3% correction, small but the kind of thing that makes a
 * familiar outline look subtly wrong. Anything fancier (a real conic projection)
 * buys nothing across a single municipality, which spans a few kilometres.
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
