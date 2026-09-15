import { lazy, Suspense, useState, type ReactNode } from 'react';
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
import { EmptyState, ErrorState } from '../../components/common/StateMessage';
import { useAdminData, useAdminScope } from '../../hooks/useAdminData';
import { emptyAdminSnapshot, type AdminSnapshot } from '../../services/adminData';

/** Before the first read lands, an empty snapshot would render as "nothing recorded". */
function FirstRead({ snapshot, loading, children }: { snapshot: AdminSnapshot; loading: boolean; children: ReactNode }) {
  if (loading && snapshot === emptyAdminSnapshot) {
    return (
      <Card className="admin-monitor" aria-busy>
        <EmptyState title="Reading the central database" text="Large areas take a few seconds." />
      </Card>
    );
  }

  return children;
}

// The two biggest screens in the portal, and the two the officer opening the
// dashboard has not asked for. Each has exactly one consumer below, so splitting
// them here costs a chunk boundary and nothing else — and it takes their four
// chart components off the path to first paint. `DonutChart` stays eager;
// `AdminDashboard` needs it.
const AnalyticsPanels = lazy(() => import('../../components/admin/AnalyticsPanels').then((module) => ({ default: module.AnalyticsPanels })));
const HealthPanels = lazy(() => import('../../components/admin/AnalyticsPanels').then((module) => ({ default: module.HealthPanels })));
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
      <FirstRead snapshot={snapshot} loading={loading}>
        <AdminDashboard snapshot={snapshot} filters={filters} loading={loading} error={error} onScope={setFilters} />
      </FirstRead>
    </>
  );
}

export function ResidentsPage() {
  const { scope, filters, setFilters, loading, error } = useAdminScope();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="users"
        title="Residents"
        description="Every resident recorded by the health workers, listed by barangay."
        actions={
          <AdminFilterBar
            filters={filters}
            onChange={setFilters}
            loading={loading}
            snapshot={scope}
            role={role}
            fields={['sex', 'ageBand', 'membership']}
          />
        }
      />
      <Card className="admin-monitor">
        {error ? <ErrorState title="Could not load the records" text={error} /> : null}
        <IndividualsTable filters={filters} />
      </Card>
    </>
  );
}

export function InventoryPage() {
  const { scope, filters, setFilters, loading, error, refresh } = useAdminScope();
  const role = useAdminRole();
  const canMoveStock = role === 'barangay_admin';
  // Bumped after a movement so both server-paged stock tables and the item list re-read.
  const [movementToken, setMovementToken] = useState(0);

  function handleChanged() {
    refresh();
    setMovementToken((token) => token + 1);
  }

  return (
    <>
      <PageHeader
        icon="package"
        title="Inventory"
        description="What the barangay still holds, and what the health workers are carrying."
        actions={
          <AdminFilterBar
            filters={filters}
            onChange={setFilters}
            loading={loading}
            snapshot={scope}
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
      {canMoveStock ? <InventoryControls onChanged={handleChanged} reloadToken={movementToken} /> : null}
      <Card className="admin-monitor">
        {error ? <ErrorState title="Could not load the supplies" text={error} /> : null}
        <div className="panel-heading">
          <h2>Held at the barangay</h2>
        </div>
        <p className="summary-context">
          What has not yet been handed to a health worker.
          {canMoveStock ? '' : ' Only a barangay administrator can move stock.'}
        </p>
        <InventoryTable filters={filters} spansBarangays={role === 'admin' && !filters.barangayId} reloadToken={movementToken} />
      </Card>
      <Card className="admin-monitor">
        <div className="panel-heading">
          <h2>Carried by health workers</h2>
        </div>
        <p className="summary-context">What was handed to a health worker, less what they have already given out.</p>
        <BhwStockTable reloadToken={movementToken} />
      </Card>
    </>
  );
}

export function AccountsPage() {
  const { scope, filters, setFilters, loading } = useAdminScope();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="shield"
        title="Account Management"
        description={
          role === 'admin'
            ? 'The barangay administrators the office appoints. Health workers are theirs to run.'
            : 'The health workers in your barangay, by purok: create one, assign a purok, or take an account out of service.'
        }
        actions={
          <AdminFilterBar
            filters={filters}
            onChange={setFilters}
            loading={loading}
            snapshot={scope}
            role={role}
            fields={['accountActive']}
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
        description="Trends over time, barangay by barangay, how supplies are being used, and what the health checks found."
        actions={<AdminFilterBar filters={filters} onChange={setFilters} loading={loading} snapshot={snapshot} role={role} />}
      />
      {error ? (
        <Card className="admin-monitor">
          <ErrorState title="Could not load the records" text={error} />
        </Card>
      ) : null}
      <FirstRead snapshot={snapshot} loading={loading}>
        <Suspense fallback={null}>
          <AnalyticsPanels snapshot={snapshot} filters={filters} loading={loading} />
        </Suspense>
      </FirstRead>
    </>
  );
}

export function HealthPage() {
  const { scope, filters, setFilters, loading, error } = useAdminScope();
  const role = useAdminRole();

  return (
    <>
      <PageHeader
        icon="heart"
        title="Health"
        description="Each resident's latest health check in the period: vitals, illness and vaccination."
        actions={<AdminFilterBar filters={filters} onChange={setFilters} loading={loading} snapshot={scope} role={role} />}
      />
      {error ? (
        <Card className="admin-monitor">
          <ErrorState title="Could not load the records" text={error} />
        </Card>
      ) : null}
      <div aria-busy={loading}>
        <Suspense fallback={null}>
          <HealthPanels scope={scope} filters={filters} />
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
        description="Summaries for the period you choose, exported as one report ready to print or save as PDF."
        actions={
          <AdminFilterBar filters={filters} onChange={setFilters} loading={loading} snapshot={snapshot} role={role} sections />
        }
      />
      <Card className="activity-panel" aria-busy={loading}>
        {error ? <ErrorState title="Could not load the records" text={error} /> : null}
        <FirstRead snapshot={snapshot} loading={loading}>
          <Suspense fallback={null}>
            <ReportCards snapshot={snapshot} filters={filters} onFiltersChange={setFilters} loading={loading} role={role} />
          </Suspense>
        </FirstRead>
      </Card>
    </>
  );
}
