import { useEffect, useState } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import { buildReportCsv, downloadCsv, reportFileName, type CsvColumn } from '../../lib/csv';
import { fetchAccounts, type AccountRow } from '../../services/adminData';
import { Button } from '../common/Button';
import { ErrorState } from '../common/StateMessage';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

const columns: TableColumn<AccountRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (account) => account.profile.full_name,
  },
  {
    key: 'role',
    header: 'Role',
    render: (account) => (account.profile.role === 'admin' ? 'Admin / LGU' : 'Barangay Health Worker'),
  },
  {
    key: 'assigned-purok',
    header: 'Assigned Purok',
    // A BHW with no active assignment can neither read nor write a field row
    // under the purok policies, so an empty cell here is the reason a device
    // that signs in successfully still sees nothing.
    render: (account) =>
      account.purokName ?? (account.profile.role === 'admin' ? 'All puroks' : 'None — cannot sync'),
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
 * the route guard and every RLS helper read, so what this screen shows about an
 * account is what the database will actually enforce for it.
 *
 * Read-only on purpose. FR-08's mutations (create, assign, deactivate, reset)
 * all go through the `admin_*` SECURITY DEFINER RPCs so they carry an audit
 * event; wiring those is a separate change, and a direct-table write from here
 * would bypass the audit trail the foundation slice exists to guarantee.
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

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <Button
          variant="ghost"
          onClick={() =>
            downloadCsv(
              reportFileName('Accounts'),
              buildReportCsv({ title: 'Accounts', from: 'all dates', to: 'all dates' }, rows, exportColumns),
            )
          }
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
