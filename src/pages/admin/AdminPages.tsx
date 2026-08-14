import { useMabisaData } from '../../app/mabisaData';
import { AccountsTable } from '../../components/admin/AccountsTable';
import { AdminDashboard } from '../../components/admin/AdminDashboard';
import { InventoryTable } from '../../components/admin/InventoryTable';
import { ReportCards } from '../../components/admin/ReportCards';
import { IndividualsTable } from '../../components/admin/IndividualsTable';
import { Card } from '../../components/common/Card';
import { PageHeader } from '../../components/common/PageHeader';

export function AdminDashboardPage() {
  const { snapshot } = useMabisaData();

  return (
    <>
      <PageHeader
        eyebrow="Admin overview"
        title="Barangay Monitoring Dashboard"
        description="Desktop-first view of local resident profiles, health assessments, inventory, supply releases, and sync readiness."
      />
      <AdminDashboard snapshot={snapshot} />
    </>
  );
}

export function ResidentsPage() {
  const { snapshot } = useMabisaData();

  return (
    <>
      <PageHeader eyebrow="Residents" title="Resident Registry" description="Search and review resident profiles saved on this device." />
      <Card className="admin-monitor">
        <IndividualsTable pendingQueueCount={snapshot.pendingQueueCount} />
      </Card>
    </>
  );
}

export function InventoryPage() {
  const { snapshot } = useMabisaData();

  return (
    <>
      <PageHeader eyebrow="Inventory" title="Supply Inventory" description="Monitor local supply stock levels and low-stock indicators." />
      <Card className="admin-monitor">
        <InventoryTable inventoryItems={snapshot.inventoryItems} />
      </Card>
    </>
  );
}

export function AccountsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Accounts"
        title="Account Management"
        description="Prepared admin surface for user accounts while preserving the existing authentication implementation."
      />
      <Card className="admin-monitor">
        <AccountsTable />
      </Card>
    </>
  );
}

export function ReportsPage() {
  const { snapshot } = useMabisaData();

  return (
    <>
      <PageHeader eyebrow="Reports" title="Reports and Analytics" description="Review recent nutrition and supply allocation activity from local records." />
      <Card className="activity-panel">
        <ReportCards assessments={snapshot.assessments} disbursements={snapshot.disbursements} />
      </Card>
    </>
  );
}
