import { Link } from 'react-router-dom';
import { titleCase } from '../../lib/utils';
import { EmptyState } from '../common/StateMessage';
import type { Tally } from '../../services/adminData';

type SummaryBarsProps = {
  rows: Tally[];
  emptyTitle: string;
  emptyText: string;
  /** Where a category's rows can be listed. Given, every row becomes a link. */
  hrefFor?: (row: Tally) => string;
};

/**
 * A distribution as labelled bars: the count is the answer and the bar is the
 * comparison, so both are on the row rather than one being inferred from the
 * other. Percentages are of the rows in the summary, which is why the total is
 * derived here instead of being passed in — a caption saying 40% of a set the
 * caller measured differently is the way this kind of panel goes wrong.
 */
export function SummaryBars({ rows, emptyTitle, emptyText, hrefFor }: SummaryBarsProps) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  if (!total) {
    return <EmptyState title={emptyTitle} text={emptyText} />;
  }

  return (
    <ul className="summary-bars">
      {rows.map((row) => {
        const share = Math.round((row.count / total) * 100);
        const bar = (
          <>
            <div className="summary-bar-label">
              <span>{titleCase(row.label)}</span>
              <strong>
                {row.count} <small>({share}%)</small>
              </strong>
            </div>
            <div
              className="summary-bar-track"
              role="img"
              aria-label={`${titleCase(row.label)}: ${row.count} of ${total}, ${share} percent`}
            >
              <div className="summary-bar-fill" style={{ width: `${share}%` }} />
            </div>
          </>
        );

        // A category with nobody in it goes nowhere: the link would open a list
        // that is empty by arithmetic, which reads as a broken screen.
        const href = row.count && hrefFor ? hrefFor(row) : null;

        return (
          <li key={row.label}>
            {href ? (
              <Link className="summary-bar-link" to={href}>
                {bar}
              </Link>
            ) : (
              bar
            )}
          </li>
        );
      })}
    </ul>
  );
}
