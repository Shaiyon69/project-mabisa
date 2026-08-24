import { AccountsTable } from '../../components/admin/AccountsTable';
import { AdminDashboard } from '../../components/admin/AdminDashboard';
import { useAdminRole } from '../../components/admin/adminRole';
import { InventoryControls } from '../../components/admin/InventoryControls';
import { AdminFilterBar } from '../../components/admin/AdminFilterBar';
import { InventoryTable } from '../../components/admin/InventoryTable';
import { ReportCards } from '../../components/admin/ReportCards';
import { IndividualsTable } from '../../components/admin/IndividualsTable';
import { Card } from '../../components/common/Card';
import { PageHeader } from '../../components/common/PageHeader';
import { ErrorState } from '../../components/common/StateMessage';
import { useAdminData } from '../../hooks/useAdminData';

/**
 * Every page here reads the central database through `useAdminData`, never
 * `useMabisaData().snapshot`. That snapshot is the local SQLite mirror the BHW
 * app writes to, so on an LGU workstation it is empty and on a shared machine it
 * is whatever the last field device left — FR-06 requires the central data, and
 * the portal is a wired desktop that can always reach it.
 */

export function AdminDashboardPage() {
  const { snapshot, filters, setFilters, loading, error, refresh } = useAdminData();

  return (
    <>
      <PageHeader
        eyebrow="Admin overview"
        title="Barangay Monitoring Dashboard"
        description="Centrally synchronized resident profiles, health assessments, inventory, and supply releases for the selected period."
      />
      <AdminFilterBar filters={filters} onChange={setFilters} onRefresh={refresh} loading={loading} snapshot={snapshot} />
      <AdminDashboard snapshot={snapshot} filters={filters} loading={loading} error={error} />
    </>
  );
}

export function ResidentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Residents"
        title="Resident Registry"
        description="Search and review every resident profile synchronized to the central database."
      />
      <Card className="admin-monitor">
        <IndividualsTable />
      </Card>
    </>
  );
}

export function InventoryPage() {
  const { snapshot, loading, error, refresh } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Supply Inventory"
        description="Stock the barangay still holds unallocated, and what is left to hand out. Quantities already allocated to a health worker are counted against that worker, not here."
      />
      {/*
        Stock controls belong to the barangay administrator alone. An RHU account
        is an oversight surface: it reads every barangay and writes to none, and
        the three RPCs behind these forms refuse it regardless of what is on
        screen. Hiding them keeps the portal honest about that rather than
        offering a button whose only outcome is a permission error.
      */}
      {role === 'barangay_admin' ? <InventoryControls items={snapshot.inventoryItems} onChanged={refresh} /> : null}
      <Card className="admin-monitor">
        {error ? <ErrorState title="Could not read inventory" text={error} /> : null}
        <InventoryTable inventoryItems={snapshot.inventoryItems} loading={loading} />
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
        description="Accounts, roles, and purok assignments as the database enforces them. Changes go through the administrative RPCs."
      />
      <Card className="admin-monitor">
        <AccountsTable />
      </Card>
    </>
  );
}

export function ReportsPage() {
  const { snapshot, filters, setFilters, loading, error, refresh } = useAdminData();

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Reports and Analytics"
        description="Demographic, nutrition, inventory, and supply allocation summaries over a chosen period, each exportable as CSV."
      />
      <AdminFilterBar filters={filters} onChange={setFilters} onRefresh={refresh} loading={loading} snapshot={snapshot} />
      <Card className="activity-panel">
        {error ? <ErrorState title="Could not read the central database" text={error} /> : null}
        <ReportCards snapshot={snapshot} filters={filters} />
      </Card>
    </>
  );
}
