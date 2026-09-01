import { NUTRITION_ORDER, lowStockItems, tally, type AdminFilters, type AdminSnapshot } from '../../services/adminData';
import { Card } from '../common/Card';
import { ErrorState } from '../common/StateMessage';
import { InventoryTable } from './InventoryTable';
import { ReportCards } from './ReportCards';
import { IndividualsTable } from './IndividualsTable';
import { StatCard } from './StatCard';
import { SummaryBars } from './SummaryBars';
import { SummaryContext } from './AdminFilterBar';

type AdminDashboardProps = {
  snapshot: AdminSnapshot;
  filters: AdminFilters;
  loading: boolean;
  error: string | null;
};

export function AdminDashboard({ snapshot, filters, loading, error }: AdminDashboardProps) {
  const lowStock = lowStockItems(snapshot.inventoryItems);
  const releasedTotal = snapshot.disbursements.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <div className="dashboard-grid">
      {error ? (
        <Card className="admin-monitor">
          <ErrorState title="Could not read the central database" text={error} />
        </Card>
      ) : null}

      <section className="metric-grid admin-metrics" aria-label="Admin metrics" aria-busy={loading}>
        {/* Households and residents are totals; the rest are scoped to the
            selected period, which is what the caption below spells out. */}
        <StatCard label="Households" value={snapshot.householdCount} detail="Profiled centrally" tone="blue" />
        {/* "Active" is not decoration: the count filters on status, the registry
            table below it does not, so the two disagree by everyone who moved out. */}
        <StatCard label="Active residents" value={snapshot.residentCount} detail="Profiled centrally" tone="blue" />
        <StatCard label="Assessments" value={snapshot.assessments.length} detail="In selected period" tone="green" />
        <StatCard label="Units released" value={releasedTotal} detail="In selected period" tone="amber" />
        <StatCard label="Low unallocated stock" value={lowStock.length} detail="Items with 10 or fewer left to hand out" tone="red" />
      </section>

      <Card className="admin-monitor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Health</p>
            <h2>Nutrition Status Distribution</h2>
          </div>
        </div>
        <SummaryContext filters={filters} />
        <SummaryBars
          rows={tally(snapshot.assessments, (assessment) => assessment.nutrition_status, NUTRITION_ORDER)}
          emptyTitle="No assessments in this period"
          emptyText="Widen the date range, or wait for a field device to sync."
        />
      </Card>

      <Card className="admin-monitor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Individual</p>
            <h2>Resident Monitoring</h2>
          </div>
        </div>
        <IndividualsTable />
      </Card>

      <Card className="admin-monitor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inventory</p>
            <h2>Supply Monitoring</h2>
          </div>
        </div>
        <InventoryTable inventoryItems={snapshot.inventoryItems} />
      </Card>

      <Card className="activity-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Reports</p>
            <h2>Period Summaries</h2>
          </div>
        </div>
        <ReportCards snapshot={snapshot} filters={filters} />
      </Card>
    </div>
  );
}
