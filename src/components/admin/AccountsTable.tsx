import { useEffect, useState } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import { buildReportCsv, downloadCsv, reportFileName, type CsvColumn } from '../../lib/csv';
import { fetchAccounts, type AccountRow, fetchBarangayScope } from '../../services/adminData';
import type { UserRole } from '../../types/database';
import { Button } from '../common/Button';
import { ErrorState } from '../common/StateMessage';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

/** Every role spelled out as a map, not a ternary — a ternary can't warn when a fourth role appears. */
const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'RHU Administrator',
  barangay_admin: 'Barangay Administrator',
  bhw: 'Barangay Health Worker',
};

/** What the purok column means for a role that is not assigned to one. */
const SCOPE_WITHOUT_PUROK: Record<UserRole, string> = {
  admin: 'All barangays',
  barangay_admin: 'Whole barangay',
  // An unassigned BHW can't read or write a field row — this is why their signed-in device sees nothing.
  bhw: 'None — cannot sync',
};

const columns: TableColumn<AccountRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (account) => account.profile.full_name,
  },
  {
    key: 'role',
    header: 'Role',
    render: (account) => ROLE_LABELS[account.profile.role],
  },
  {
    key: 'assigned-purok',
    header: 'Assigned Purok',
    render: (account) => account.purokName ?? SCOPE_WITHOUT_PUROK[account.profile.role],
  },
  {
    key: 'assigned-since',
    header: 'Assigned Since',
    render: (account) => (account.assignedSince ? formatDate(account.assignedSince) : '—'),
  },
  {
    key: 'status',
    header: 'Status',
    render: (account) => (
      <TableBadge
        label={account.profile.is_active ? 'Active' : 'Deactivated'}
        tone={account.profile.is_active ? 'success' : 'warning'}
      />
    ),
  },
];

const exportColumns: CsvColumn<AccountRow>[] = [
  { header: 'User ID', value: (row) => row.profile.user_id },
  { header: 'Name', value: (row) => row.profile.full_name },
  { header: 'Role', value: (row) => titleCase(row.profile.role) },
  { header: 'Assigned purok', value: (row) => row.purokName },
  { header: 'Assigned since', value: (row) => row.assignedSince },
  { header: 'Active', value: (row) => (row.profile.is_active ? 'Yes' : 'No') },
  { header: 'Deactivated at', value: (row) => row.profile.disabled_at },
  { header: 'Created at', value: (row) => row.profile.created_at },
];

/**
 * Accounts and their current purok, read from `public.profiles` — the same table
 * every RLS helper reads. Read-only: mutations go through the `admin_*` RPCs so
 * they carry an audit event, which a direct-table write here would bypass.
 */
export function AccountsTable() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    fetchAccounts()
      .then((result) => {
        if (current) {
          setRows(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setError(cause instanceof Error ? cause.message : 'Could not read accounts.');
        }
      })
      .finally(() => {
        if (current) {
          setLoading(false);
        }
      });

    return () => {
      current = false;
    };
  }, []);

  async function exportAccounts() {
    downloadCsv(
      reportFileName('Accounts'),
      buildReportCsv(
        { title: 'Accounts', barangay: await fetchBarangayScope(), from: 'all dates', to: 'all dates' },
        rows,
        exportColumns,
      ),
    );
  }

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <Button
          variant="ghost"
          onClick={() => void exportAccounts()}
          disabled={loading || !rows.length}
        >
          Export CSV
        </Button>
      </TableToolbar>

      {error ? <ErrorState title="Could not read accounts" text={error} /> : null}

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(account) => account.profile.user_id}
        emptyTitle={loading ? 'Reading accounts' : 'No accounts found'}
        emptyText={
          loading
            ? 'One moment.'
            : 'Accounts are created through the administrative RPCs; see the foundation bootstrap procedure.'
        }
      />

      <TableMeta shown={rows.length} total={rows.length} label="account" />
    </div>
  );
}
