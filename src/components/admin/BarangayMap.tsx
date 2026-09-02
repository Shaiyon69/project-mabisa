import { useMemo } from 'react';
import { barangayShapes, boundaryKey, fitProjection } from '../../lib/geo';
import type { Barangay } from '../../types/database';
import type { BarangayStats } from '../../services/adminData';
import { EmptyState } from '../common/StateMessage';

type BarangayMapProps = {
  stats: BarangayStats[];
  barangays: Barangay[];
  /** Selecting a barangay scopes the whole screen to it. Null clears the scope. */
  selected: string | null;
  onSelect: (barangayId: string | null) => void;
};

/** `12 of 48 (25%)`, or an em dash when the denominator is zero. */
function describeRate(row: BarangayStats): string {
  if (row.underweightRate === null) {
    return 'no assessments in this period';
  }

  return `${row.underweight} of ${row.assessments} (${Math.round(row.underweightRate * 100)}%)`;
}

/**
 * Underweight readings by barangay, drawn on the barangay outlines. Shaded by
 * rate rather than count, or the largest barangay reads as the worst every time.
 * The count and its denominator are both on the label.
 *
 * Captioned "underweight", never "malnutrition": a BMI band is a reading, not a
 * diagnosis.
 */
export function BarangayMap({ stats, barangays, selected, onSelect }: BarangayMapProps) {
  const shaped = useMemo(() => {
    // Matched on the barangay's own code or name, so a boundary file from any
    // source lines up without a second mapping table.
    const codes = new Map(
      barangays.map((barangay) => [barangay.barangay_id, boundaryKey(barangay.code ?? barangay.name)]),
    );

    return stats.flatMap((row) => {
      const shape = barangayShapes.find((candidate) => candidate.key === codes.get(row.barangayId));

      return shape ? [{ row, shape }] : [];
    });
  }, [stats, barangays]);

  const projection = useMemo(() => fitProjection(shaped.map((entry) => entry.shape)), [shaped]);
  const missing = stats.filter((row) => !shaped.some((entry) => entry.row.barangayId === row.barangayId));

  // The darkest shade is the worst rate on screen rather than a fixed 100%, so a
  // barangay at 8% among neighbours at 1% is visible. The legend prints both ends,
  // since a relative scale has to say where it tops out.
  const worst = Math.max(...stats.map((row) => row.underweightRate ?? 0), 0.01);

  if (!projection) {
    return (
      <div className="barangay-map-fallback">
        <EmptyState
          title="No barangay boundaries on file"
          text="Add a GeoJSON export of your municipality's barangay outlines at src/data/barangay-boundaries.json, with a code or name on each feature matching the barangay record. Until then the same figures are listed below."
        />
        <BarangayRateList rows={stats} worst={worst} selected={selected} onSelect={onSelect} />
      </div>
    );
  }

  return (
    <div className="barangay-map">
      <svg
        viewBox={`0 0 ${projection.width} ${projection.height.toFixed(0)}`}
        role="img"
        aria-label={`Underweight rate by barangay. ${shaped
          .map((entry) => `${entry.row.name}: ${describeRate(entry.row)}`)
          .join('. ')}`}
      >
        {shaped.map(({ row, shape }) => (
          <path
            key={row.barangayId}
            d={projection.path(shape.polygons)}
            className={`barangay-shape${selected === row.barangayId ? ' is-selected' : ''}`}
            // Opacity rather than a computed colour, so the fill is one theme
            // token and survives the dark palette.
            style={{ fillOpacity: 0.1 + 0.75 * ((row.underweightRate ?? 0) / worst) }}
            onClick={() => onSelect(selected === row.barangayId ? null : row.barangayId)}
            tabIndex={0}
            role="button"
            aria-pressed={selected === row.barangayId}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(selected === row.barangayId ? null : row.barangayId);
              }
            }}
          >
            <title>{`${row.name} — underweight ${describeRate(row)}`}</title>
          </path>
        ))}
      </svg>

      <div className="map-legend">
        <span className="muted">Underweight rate</span>
        <span className="legend-ramp" aria-hidden="true" />
        <span className="muted">0% – {Math.round(worst * 100)}% of assessments in this period</span>
      </div>

      <BarangayRateList rows={stats} worst={worst} selected={selected} onSelect={onSelect} />

      {missing.length ? (
        <p className="summary-context">
          No boundary on file for {missing.map((row) => row.name).join(', ')} — listed above, not drawn.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The same numbers as a ranked list, beside the map for a reader who needs to
 * quote a figure. Stands alone as the whole panel when no boundary file is supplied.
 */
function BarangayRateList({
  rows,
  worst,
  selected,
  onSelect,
}: {
  rows: BarangayStats[];
  worst: number;
  selected: string | null;
  onSelect: (barangayId: string | null) => void;
}) {
  const ranked = [...rows].sort((a, b) => (b.underweightRate ?? -1) - (a.underweightRate ?? -1));

  if (!ranked.length) {
    return <EmptyState title="No barangays" text="Barangay records appear here once one has been created." />;
  }

  return (
    <ul className="summary-bars barangay-rate-list">
      {ranked.map((row) => (
        <li key={row.barangayId || 'unassigned'}>
          <button
            type="button"
            className={`summary-bar-link${selected === row.barangayId ? ' is-selected' : ''}`}
            aria-pressed={selected === row.barangayId}
            // The unassigned bucket is a data-quality row, not a place to scope to.
            disabled={!row.barangayId}
            onClick={() => onSelect(selected === row.barangayId ? null : row.barangayId)}
          >
            <div className="summary-bar-label">
              <span>{row.name}</span>
              <strong>
                {row.underweightRate === null ? '—' : `${Math.round(row.underweightRate * 100)}%`}{' '}
                <small>({describeRate(row)})</small>
              </strong>
            </div>
            <div className="summary-bar-track">
              <div
                className="summary-bar-fill is-alert"
                style={{ width: `${Math.round(((row.underweightRate ?? 0) / worst) * 100)}%` }}
              />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
