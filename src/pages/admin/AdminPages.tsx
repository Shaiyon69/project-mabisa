import { lazy, Suspense, useState } from 'react';
import { AccountsTable } from '../../components/admin/AccountsTable';
import { AdminDashboard } from '../../components/admin/AdminDashboard';
import { useAdminRole } from '../../components/admin/adminRole';
import { InventoryControls } from '../../components/admin/InventoryControls';
import { AdminFilterBar } from '../../components/admin/AdminFilterBar';
import { InventoryTable } from '../../components/admin/InventoryTable';
import { IndividualsTable } from '../../components/admin/IndividualsTable';
import { BhwStockTable } from '../../components/admin/BhwStockTable';
import { Card } from '../../components/common/Card';
import { PageHeader } from '../../components/common/PageHeader';
import { ErrorState } from '../../components/common/StateMessage';
import { useAdminData } from '../../hooks/useAdminData';
import { filterInventory } from '../../services/adminData';

// The two biggest screens in the portal, and the two the officer opening the
// dashboard has not asked for. Each has exactly one consumer below, so splitting
// them here costs a chunk boundary and nothing else — and it takes their four
// chart components off the path to first paint. `DonutChart` stays eager;
// `AdminDashboard` needs it.
const AnalyticsPanels = lazy(() => import('../../components/admin/AnalyticsPanels').then((module) => ({ default: module.AnalyticsPanels })));
const ReportCards = lazy(() => import('../../components/admin/ReportCards').then((module) => ({ default: module.ReportCards })));

/**
 * Every page here reads the central database through `useAdminData`, never
 * `useMabisaData().snapshot` — that snapshot is the BHW app's local SQLite
 * mirror, which on a workstation is empty.
 *
 * Two roles reach these screens: `admin` reads every barangay, `barangay_admin`
 * runs one and is the only role the stock RPCs accept. Pages ask `useAdminRole()`
 * for which controls to offer; the scoping itself is enforced by RLS.
 */
export function AdminDashboardPage() {
  const { snapshot, filters, setFilters, loading, error } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="home"
        title="Dashboard"
        description={role === 'admin' ? 'Every barangay in the RHU, at a glance.' : 'Your barangay, at a glance.'}
        actions={<AdminFilterBar filters={filters} onChange={setFilters} loading={loading} snapshot={snapshot} role={role} />}
      />
      <AdminDashboard snapshot={snapshot} filters={filters} loading={loading} error={error} onScope={setFilters} />
    </>
  );
}

export function ResidentsPage() {
  const { snapshot, filters, setFilters, loading, error } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="users"
        title="Resident Registry"
        description="Every resident profile synced to the central database, by barangay."
        actions={
          <AdminFilterBar
            filters={filters}
            onChange={setFilters}
            loading={loading}
            snapshot={snapshot}
            role={role}
            fields={['sex', 'ageBand', 'membership']}
          />
        }
      />
      <Card className="admin-monitor">
        {error ? <ErrorState title="Could not read the central database" text={error} /> : null}
        <IndividualsTable filters={filters} snapshot={snapshot} />
      </Card>
    </>
  );
}

export function InventoryPage() {
  const { snapshot, filters, setFilters, loading, error, refresh } = useAdminData();
  const role = useAdminRole();
  const canMoveStock = role === 'barangay_admin';
  // Bumped after a movement so the carried-stock table re-reads `bhw_item_stock`
  // along with the snapshot, which reads `inventory_items`.
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
        description="Stock the barangay still holds unallocated, and what is left to hand out."
        actions={
          <AdminFilterBar
            filters={filters}
            onChange={setFilters}
            loading={loading}
            snapshot={snapshot}
            role={role}
            fields={['itemType', 'stockLevel']}
            // No purok control: stock is held at barangay level, and
            // `fetchAdminSnapshot` leaves inventory out of the purok guard.
            puroks={false}
          />
        }
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
        {/* `filterInventory` rather than a filter of its own, so the type and
            stock-level narrowing here decides "low" by the same rule as the
            table's own badge and the dashboard's alert count. */}
        <InventoryTable inventoryItems={filterInventory(snapshot.inventoryItems, filters)} loading={loading} />
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
  // ponytail: `useAdminData` fires the full snapshot read — households,
  // residents, assessments — on a screen that renders none of them, just to
  // populate the drawer's barangay and purok lists. It is the smallest correct
  // wiring and the portal is a wired workstation against tables of tens to
  // hundreds of rows. If it ever costs anything, switch to `useAdminFilters()`
  // and lift `AccountsTable`'s own `fetchAccounts()` + `fetchActivePuroks()`
  // (AccountsTable.tsx:88) up to here, adding a barangays read beside them.
  const { snapshot, filters, setFilters, loading } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="shield"
        title="Account Management"
        description={
          role === 'admin'
            ? 'Roles and purok assignments as the database enforces them.'
            : 'Health workers in your barangay: assign a purok, or take an account out of service. Roles, other barangays and new accounts are an LGU administrator action.'
        }
        actions={
          <AdminFilterBar
            filters={filters}
            onChange={setFilters}
            loading={loading}
            snapshot={snapshot}
            role={role}
            fields={['accountRole', 'accountActive']}
          />
        }
      />
      <Card className="admin-monitor">
        <AccountsTable role={role} filters={filters} />
      </Card>
    </>
  );
}

export function AnalyticsPage() {
  const { snapshot, filters, setFilters, loading, error } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="chart"
        title="Analytics"
        description="Trend, barangay comparison, coverage and supply utilization."
        actions={<AdminFilterBar filters={filters} onChange={setFilters} loading={loading} snapshot={snapshot} role={role} />}
      />
      {error ? (
        <Card className="admin-monitor">
          <ErrorState title="Could not read the central database" text={error} />
        </Card>
      ) : null}
      <div aria-busy={loading}>
        <Suspense fallback={null}>
          <AnalyticsPanels snapshot={snapshot} filters={filters} />
        </Suspense>
      </div>
    </>
  );
}

export function ReportsPage() {
  const { snapshot, filters, setFilters, loading, error } = useAdminData();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="clipboard"
        title="Reports"
        description="Period summaries, each exportable as CSV."
        actions={
          <AdminFilterBar filters={filters} onChange={setFilters} loading={loading} snapshot={snapshot} role={role} sections />
        }
      />
      <Card className="activity-panel">
        {error ? <ErrorState title="Could not read the central database" text={error} /> : null}
        <Suspense fallback={null}>
          <ReportCards snapshot={snapshot} filters={filters} />
        </Suspense>
      </Card>
    </>
  );
}
