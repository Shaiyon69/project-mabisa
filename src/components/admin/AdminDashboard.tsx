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
 *
 * This screen used to also mount `IndividualsTable`, `InventoryTable` and the
 * whole of `ReportCards` — the Residents, Inventory and Reports pages rendered
 * again underneath the summary. Those pages are one click away in the rail, and
 * a dashboard that repeats them is three screens of scrolling with nothing on it
 * that the rail does not already lead to. Detail belongs on the page that owns
 * it; what stays here is what someone reads and then acts on.
 */
export function AdminDashboard({ snapshot, filters, loading, error, onScope }: AdminDashboardProps) {
  const lowStock = lowStockItems(snapshot.inventoryItems);
  const releasedTotal = snapshot.disbursements.reduce((sum, row) => sum + row.quantity, 0);
  const stats = barangayStats(snapshot);
  // One tally feeding both the ring and the bars beside it, so the two halves of
  // the card cannot disagree about a band.
  const nutrition = tally(snapshot.assessments, (assessment) => assessment.nutrition_status, NUTRITION_ORDER);

  // Every link carries the period *and the barangay*, so the screen it opens
  // answers the question this tile asked. A drill-down that silently changes
  // either shows a different number under the same heading.
  const period = `from=${filters.from}&to=${filters.to}${filters.barangayId ? `&barangay=${filters.barangayId}` : ''}`;

  return (
    <div className="dashboard-grid">
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
        <StatCard label="Households" value={snapshot.householdCount} tone="blue" icon="home" />
        <StatCard label="Residents" value={snapshot.residentCount} tone="blue" icon="users" to={`/admin/residents?${period}`} />
        <StatCard
          label="Assessments"
          value={snapshot.assessments.length}
          tone="green"
          icon="heart"
          to={`/admin/reports?${period}`}
        />
        <StatCard
          label="Units released"
          value={releasedTotal}
          tone="amber"
          icon="package"
          to={`/admin/reports?${period}`}
        />
        {/* Red only when there is something to be red about. Alert colour is
            rationed on this surface, and a tile that is red at zero spends it
            on nothing. */}
        <StatCard
          label="Low stock"
          value={lowStock.length}
          tone={lowStock.length ? 'red' : 'blue'}
          icon="warning"
          to="/admin/inventory"
        />
      </section>

      <p className="summary-context admin-metrics-note">
        Households and residents are running totals. Assessments and units released cover the selected period; stock is
        the current position.
      </p>

      {/* Where, before how many. The distribution below says what the readings
          were across the whole scope; this says which barangay they came from,
          which is the first thing an officer with several barangays asks and the
          thing a single distribution bar cannot answer. Selecting one narrows
          every panel on the screen rather than opening a new one. */}
      <Card className="admin-monitor">
        <div className="panel-heading">
          <h2>Underweight Readings by Barangay</h2>
          <Link className="admin-link" to={`/admin/analytics?${period}`}>
            Open analytics
          </Link>
        </div>
        <SummaryContext filters={filters} barangays={snapshot.barangays} />
        <BarangayMap
          stats={stats}
          barangays={snapshot.barangays}
          selected={filters.barangayId}
          onSelect={(barangayId) => onScope({ ...filters, barangayId })}
        />
      </Card>

      <Card className="admin-monitor">
        <div className="panel-heading">
          <h2>Nutrition Status Distribution</h2>
        </div>
        <SummaryContext filters={filters} barangays={snapshot.barangays} />
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
          <h2>Needs Restocking</h2>
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
  );
}
