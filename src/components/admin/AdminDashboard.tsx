import { Link } from 'react-router-dom';
import {
  NUTRITION_ORDER,
  barangayStats,
  lowStockItems,
  tally,
  type AdminFilters,
  type AdminSnapshot,
} from '../../services/adminData';
import { NUTRITION_COLORS } from '../../lib/charts';
import { titleCase } from '../../lib/utils';
import { Card } from '../common/Card';
import { ErrorState } from '../common/StateMessage';
import { BarangayMap } from './BarangayMap';
import { DonutChart } from './Charts';
import { StatCard } from './StatCard';
import { SummaryBars } from './SummaryBars';
import { SummaryContext } from './AdminFilterBar';

type AdminDashboardProps = {
  snapshot: AdminSnapshot;
  filters: AdminFilters;
  loading: boolean;
  error: string | null;
  /** Clicking a barangay on the map scopes the whole screen to it. */
  onScope: (filters: AdminFilters) => void;
};

/**
 * What the officer needs before choosing where to go: the totals, the one
 * distribution the barangay is monitored on, and the items that need restocking.
 * Detail belongs on the page that owns it, one click away in the rail.
 */
export function AdminDashboard({ snapshot, filters, loading, error, onScope }: AdminDashboardProps) {
  const lowStock = lowStockItems(snapshot.inventoryItems);
  const releasedTotal = snapshot.disbursements.reduce((sum, row) => sum + row.quantity, 0);
  // Rows gathered under this scope, not units: a release of forty sachets is one
  // record. `releasedTotal` above is the quantity question.
  const recordsGathered =
    snapshot.householdCount + snapshot.residentCount + snapshot.assessments.length + snapshot.disbursements.length;
  const stats = barangayStats(snapshot);
  // One tally feeding both the ring and the bars, so the two cannot disagree.
  const nutrition = tally(snapshot.assessments, (assessment) => assessment.nutrition_status, NUTRITION_ORDER);

  // Every link carries the period and the barangay, so the screen it opens answers
  // the question the tile asked.
  const period = `from=${filters.from}&to=${filters.to}${filters.barangayId ? `&barangay=${filters.barangayId}` : ''}`;

  return (
    <div className="dashboard-grid admin-dashboard-grid">
      {error ? (
        <Card className="admin-monitor">
          <ErrorState title="Could not read the central database" text={error} />
        </Card>
      ) : null}

      <section className="metric-grid admin-metrics" aria-label="Admin metrics" aria-busy={loading}>
        {/* No caption per tile. Four of the five carried one of two phrases, so
            five repetitions said what one line under the grid says once.

            Households has no `to`: the portal has no household screen, and a
            tile that looks clickable and is not is worse than a plain one. */}
        {/* Everything this scope has gathered, in one figure. It is the first
            question asked of a portal that exists to prove records are coming
            in at all, and it is the one number no other tile answers — the four
            below it each count one kind of row. It links nowhere because no
            single screen owns the sum. */}
        <StatCard label="Records gathered" value={recordsGathered} tone="green" icon="clipboard" />
        <StatCard label="Households" value={snapshot.householdCount} tone="blue" icon="home" />
        {/* "Active" is not decoration: the count filters on status, the registry
            table it links to does not, so the two disagree by everyone who moved out. */}
        <StatCard
          label="Active residents"
          value={snapshot.residentCount}
          tone="blue"
          icon="users"
          to={`/admin/residents?${period}`}
        />
        <StatCard
          label="Assessments recorded"
          value={snapshot.assessments.length}
          tone="green"
          icon="heart"
          to={`/admin/reports?${period}`}
        />
        <StatCard
          label="Supplies released"
          value={releasedTotal}
          tone="amber"
          icon="package"
          to={`/admin/reports?${period}`}
        />
        {/* Red only when there is something to be red about. Alert colour is
            rationed on this surface, and a tile that is red at zero spends it
            on nothing. */}
        <StatCard
          label="Items below reorder level"
          value={lowStock.length}
          tone={lowStock.length ? 'red' : 'blue'}
          icon="warning"
          to="/admin/inventory"
        />
      </section>

      <p className="summary-context admin-metrics-note">
        Households and residents are running totals. Assessments and units released cover the selected period; stock is
        the current position. Records gathered adds the four together, so it mixes both.
      </p>

      {/* Where, before how many. The distribution below says what the readings
          were across the whole scope; this says which barangay they came from,
          which is the first thing an officer with several barangays asks and the
          thing a single distribution bar cannot answer. Selecting one narrows
          every panel on the screen rather than opening a new one. */}
      <Card className="admin-monitor">
        <div className="panel-heading">
          <h2>Underweight rate by barangay</h2>
          <Link className="admin-link" to={`/admin/analytics?${period}`}>
            Open analytics
          </Link>
        </div>
        <SummaryContext filters={filters} snapshot={snapshot} />
        <BarangayMap
          stats={stats}
          barangays={snapshot.barangays}
          selected={filters.barangayId}
          onSelect={(barangayId) => onScope({ ...filters, barangayId })}
        />
      </Card>

      {/* Nutrition and restocking are two short panels, not one tall one, and
          on a wide screen they sit beside the map rather than under it — the
          wrapper is what lets the grid put them in the right column while the
          map spans the left one. Below the two-column breakpoint this is a
          plain block and the pair stacks exactly as it did before. */}
      <div className="dashboard-side">
        <Card className="admin-monitor">
          <div className="panel-heading">
            <h2>Nutrition status</h2>
          </div>
          <SummaryContext filters={filters} snapshot={snapshot} />
          {/* The ring is the mix and the bars are the counts, side by side rather
              than one instead of the other: a share answers "how lopsided" and a
              count answers "how many", and an officer acts on the second. Each
              band opens the residents it counted, over this same period. */}
          <div className="chart-with-bars">
            {/* No ring at all when nothing was recorded — an empty circle round a
                zero reads as a chart that failed to load. `SummaryBars` says why. */}
            {nutrition.some((row) => row.count) ? (
              <DonutChart rows={nutrition} colorFor={(row) => NUTRITION_COLORS[row.label]} unit="assessments" />
            ) : null}
            <SummaryBars
              rows={nutrition}
              emptyTitle="No assessments in this period"
              emptyText="Widen the date range, or wait for a field device to sync."
              hrefFor={(row) => `/admin/residents?status=${row.label}&${period}`}
            />
          </div>
        </Card>

        {/* The one thing on this screen that asks for an action rather than a
            reading, so it is the one list that stays. */}
        <Card className="admin-monitor">
          <div className="panel-heading">
            <h2>Needs restocking</h2>
            <Link className="admin-link" to="/admin/inventory">
              Open inventory
            </Link>
          </div>
          {lowStock.length ? (
            <ul className="compact-list">
              {lowStock.map((item) => (
                <li key={item.item_id}>
                  <span>{item.item_name}</span>
                  <small>
                    {item.current_stock} on hand • {titleCase(item.type)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Every item is above the low-stock threshold.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
