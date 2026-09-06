import { axisTicks, niceMax } from '../../lib/charts';
import { rankByUnderweight, type BarangayStats } from '../../services/adminData';
import { EmptyState } from '../common/StateMessage';

type BarangayRatesProps = {
  stats: BarangayStats[];
  /** Selecting a barangay scopes the whole screen to it. Null clears the scope. */
  selected: string | null;
  onSelect: (barangayId: string | null) => void;
};

/** Rows the panel shows before deferring to the analytics comparison. */
const TOP_N = 8;

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
  const ranked = rankByUnderweight(stats);
  // The worst few plus whichever barangay is scoped, or selecting one from the
  // filter drawer would empty its row off the panel that shows the selection.
  const shown = ranked.filter((row, index) => index < TOP_N || row.barangayId === selected);
  const hidden = ranked.length - shown.length;
  // Whole percents against a round top, so a bar's length is its rate and not its
  // rank — normalising to the worst rate on screen drew the leader full whether it
  // stood at 34% or at 3%. The top still sits just above the data rather than at a
  // fixed 100%, which is what kept a barangay at 8% visible among neighbours at 1%.
  const scale = niceMax(Math.max(...shown.map((row) => Math.round((row.underweightRate ?? 0) * 100)), 1));

  if (!ranked.length) {
    return <EmptyState title="No barangays" text="Barangay records appear here once one has been created." />;
  }

  return (
    <>
      <ul className="summary-bars barangay-rate-list">
        {shown.map((row) => (
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
                  // A rate of zero draws nothing: the fill's minimum width exists to keep
                  // a low rate visible, and lending it to a zero claims a reading there.
                  data-zero={row.underweightRate ? undefined : ''}
                  style={{ width: `${Math.round(((row.underweightRate ?? 0) * 100 * 100) / scale)}%` }}
                />
              </div>
            </button>
          </li>
        ))}
      </ul>
      {/* The scale the lengths are read against, once under the rows. Hidden from
          assistive technology: every row already carries its own rate in words. */}
      <div className="bar-chart-axis barangay-rate-axis" aria-hidden="true">
        {axisTicks(scale).map((tick) => (
          <span key={tick}>{tick}%</span>
        ))}
      </div>
      {hidden > 0 ? (
        <p className="summary-context">
          Highest {shown.length} of {ranked.length} barangays. Analytics compares them all, and the filter drawer
          reaches any one of them.
        </p>
      ) : null}
    </>
  );
}
