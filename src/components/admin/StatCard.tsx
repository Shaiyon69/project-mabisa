import { Link } from 'react-router-dom';
import { Icon } from '../common/Icon';

type StatCardProps = {
  label: string;
  value: number;
  tone: 'blue' | 'green' | 'amber' | 'red';
  /** Marks what the number counts. Five tiles in a row read as five numbers otherwise. */
  icon: 'home' | 'users' | 'heart' | 'package' | 'warning';
  /** Where this number can be seen as rows. Omitted where the portal has no such screen. */
  to?: string;
};

/**
 * A tile is an icon, a label and a number. The per-tile caption is gone: four of
 * the five repeated one of two phrases, which is a caption for the grid.
 *
 * A tile with a `to` is a link, and looks like one — hover lift, a chevron, a
 * pointer. Without it, it is a plain `div`: the portal has no household screen,
 * and a tile that looks clickable and is not is worse than one that never
 * offered.
 */
export function StatCard({ label, value, tone, icon, to }: StatCardProps) {
  const body = (
    <>
      <span className="metric-label">
        <Icon name={icon} size={17} />
        {label}
      </span>
      <strong>{value}</strong>
      {to ? <Icon name="chevron" size={16} className="metric-caret" /> : null}
    </>
  );

  if (!to) {
    return <div className={`metric metric-${tone}`}>{body}</div>;
  }

  return (
    <Link className={`metric metric-${tone} metric-link`} to={to}>
      {body}
    </Link>
  );
}
