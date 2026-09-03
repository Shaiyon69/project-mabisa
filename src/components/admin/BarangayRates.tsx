import type { BarangayStats } from '../../services/adminData';
import { EmptyState } from '../common/StateMessage';

type BarangayRatesProps = {
  stats: BarangayStats[];
  /** Selecting a barangay scopes the whole screen to it. Null clears the scope. */
  selected: string | null;
  onSelect: (barangayId: string | null) => void;
};

/** `12 of 48 (25%)`, or a phrase when the denominator is zero. */
function describeRate(row: BarangayStats): string {
  if (row.underweightRate === null) {
    return 'no assessments in this period';
  }

  return `${row.underweight} of ${row.assessments} (${Math.round(row.underweightRate * 100)}%)`;
}

/**
 * Underweight readings by barangay, ranked by rate rather than count, or the
 * largest barangay reads as the worst every time. The count and its denominator
 * are both on the label, and selecting a row narrows every panel on the screen.
 *
 * Captioned "underweight", never "malnutrition": a BMI band is a reading, not a
 * diagnosis.
 */
export function BarangayRates({ stats, selected, onSelect }: BarangayRatesProps) {
  const ranked = [...stats].sort((a, b) => (b.underweightRate ?? -1) - (a.underweightRate ?? -1));
  // Bars run to the worst rate on screen rather than a fixed 100%, so a barangay
  // at 8% among neighbours at 1% is still visible.
  const worst = Math.max(...stats.map((row) => row.underweightRate ?? 0), 0.01);

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
