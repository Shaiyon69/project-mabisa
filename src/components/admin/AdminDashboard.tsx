import type { LocalSnapshot } from '../../app/mabisaData';
import { Card } from '../common/Card';
import { InventoryTable } from './InventoryTable';
import { ReportCards } from './ReportCards';
import { ResidentsTable } from './ResidentsTable';
import { StatCard } from './StatCard';

type AdminDashboardProps = {
  snapshot: LocalSnapshot;
};

export function AdminDashboard({ snapshot }: AdminDashboardProps) {
  return (
    <div className="dashboard-grid">
      <section className="metric-grid admin-metrics" aria-label="Admin metrics">
        <StatCard label="Residents" value={snapshot.residents.length} detail="Profiled locally" tone="blue" />
        <StatCard label="Assessments" value={snapshot.assessments.length} detail="Health records" tone="green" />
        <StatCard label="Inventory" value={snapshot.inventoryItems.length} detail="Tracked supplies" tone="amber" />
        <StatCard label="Released" value={snapshot.disbursements.length} detail="Disbursement logs" tone="red" />
      </section>
      <Card className="admin-monitor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Residents</p>
            <h2>Resident Monitoring</h2>
          </div>
        </div>
        <ResidentsTable residents={snapshot.residents} pendingQueueCount={snapshot.pendingQueueCount} />
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
            <h2>Analytics Cards</h2>
          </div>
        </div>
        <ReportCards assessments={snapshot.assessments} disbursements={snapshot.disbursements} />
      </Card>
    </div>
  );
}
