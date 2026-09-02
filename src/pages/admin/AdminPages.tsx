import { useState } from 'react';
import { AccountsTable } from '../../components/admin/AccountsTable';
import { AdminDashboard } from '../../components/admin/AdminDashboard';
import { useAdminRole } from '../../components/admin/adminRole';
import { InventoryControls } from '../../components/admin/InventoryControls';
import { AdminFilterBar } from '../../components/admin/AdminFilterBar';
import { AnalyticsPanels } from '../../components/admin/AnalyticsPanels';
import { InventoryTable } from '../../components/admin/InventoryTable';
import { ReportCards } from '../../components/admin/ReportCards';
import { IndividualsTable } from '../../components/admin/IndividualsTable';
import { BhwStockTable } from '../../components/admin/BhwStockTable';
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
 *
 * Two roles reach these screens. `admin` is the RHU or LGU account and reads
 * every barangay, which is what makes the map and the comparison meaningful;
 * `barangay_admin` runs one barangay and is the only role the stock RPCs accept.
 * Each page asks `useAdminRole()` for the difference rather than being duplicated
 * per role — the scoping is enforced by RLS either way, and what changes here is
 * only which controls are worth offering.
 */
export function AdminDashboardPage() {
  const { snapshot, filters, setFilters, loading, error, refresh } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader icon="home" title="Barangay Monitoring Dashboard" />
      <AdminFilterBar
        filters={filters}
        onChange={setFilters}
        onRefresh={refresh}
        loading={loading}
        snapshot={snapshot}
        role={role}
      />
      <AdminDashboard snapshot={snapshot} filters={filters} loading={loading} error={error} onScope={setFilters} />
    </>
  );
}

export function ResidentsPage() {
  const { snapshot, filters, setFilters, loading, error, refresh } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="users"
        title="Resident Registry"
        description="Every resident profile synced to the central database, by barangay."
      />
      {/* The registry ignores the date range — a resident is not an event — but
          it does honour the barangay, and the bar is where that control lives.
          Its own caveat line already says which half of it applies. */}
      <AdminFilterBar
        filters={filters}
        onChange={setFilters}
        onRefresh={refresh}
        loading={loading}
        snapshot={snapshot}
        role={role}
      />
      <Card className="admin-monitor">
        {error ? <ErrorState title="Could not read the central database" text={error} /> : null}
        <IndividualsTable barangayId={filters.barangayId} barangays={snapshot.barangays} />
      </Card>
    </>
  );
}

export function InventoryPage() {
  const { snapshot, loading, error, refresh } = useAdminData();
  const role = useAdminRole();
  const canMoveStock = role === 'barangay_admin';
  // Bumped after a movement so the carried-stock table re-reads its view along
  // with the snapshot. It reads a different source — the `bhw_item_stock` view
  // rather than `inventory_items` — so one refresh has to reach both or the two
  // tables disagree for as long as the page stays open.
  const [movementToken, setMovementToken] = useState(0);

  function handleChanged() {
    refresh();
    setMovementToken((token) => token + 1);
  }

  return (
    <>
      <PageHeader
        icon="package"
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
      {canMoveStock ? <InventoryControls items={snapshot.inventoryItems} onChanged={handleChanged} /> : null}
      <Card className="admin-monitor">
        {error ? <ErrorState title="Could not read inventory" text={error} /> : null}
        <div className="panel-heading">
          <h2>At the barangay</h2>
        </div>
        <p className="summary-context">
          Unallocated stock — what has not yet been handed to a health worker.
          {canMoveStock ? '' : ' Only a barangay administrator can move stock.'}
        </p>
        <InventoryTable inventoryItems={snapshot.inventoryItems} loading={loading} />
      </Card>
      <Card className="admin-monitor">
        <div className="panel-heading">
          <h2>Carried by health workers</h2>
        </div>
        <p className="summary-context">Allocated to a health worker, less what they have already released.</p>
        <BhwStockTable reloadToken={movementToken} />
      </Card>
    </>
  );
}

export function AccountsPage() {
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="shield"
        title="Account Management"
        description={
          role === 'admin'
            ? 'Roles and purok assignments as the database enforces them.'
            : 'Roles and purok assignments in your barangay. Changing them is an LGU administrator action.'
        }
      />
      <Card className="admin-monitor">
        <AccountsTable canManage={role === 'admin'} />
      </Card>
    </>
  );
}

export function AnalyticsPage() {
  const { snapshot, filters, setFilters, loading, error, refresh } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="chart"
        title="Analytics"
        description="Trend, barangay comparison, coverage and supply utilization."
      />
      <AdminFilterBar
        filters={filters}
        onChange={setFilters}
        onRefresh={refresh}
        loading={loading}
        snapshot={snapshot}
        role={role}
      />
      {error ? (
        <Card className="admin-monitor">
          <ErrorState title="Could not read the central database" text={error} />
        </Card>
      ) : null}
      <div aria-busy={loading}>
        <AnalyticsPanels snapshot={snapshot} filters={filters} />
      </div>
    </>
  );
}

export function ReportsPage() {
  const { snapshot, filters, setFilters, loading, error, refresh } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader icon="clipboard" title="Reports" description="Period summaries, each exportable as CSV." />
      <AdminFilterBar
        filters={filters}
        onChange={setFilters}
        onRefresh={refresh}
        loading={loading}
        snapshot={snapshot}
        role={role}
      />
      <Card className="activity-panel">
        {error ? <ErrorState title="Could not read the central database" text={error} /> : null}
        <ReportCards snapshot={snapshot} filters={filters} />
      </Card>
    </>
  );
}
