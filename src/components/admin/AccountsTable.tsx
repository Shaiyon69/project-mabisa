import { useEffect, useState } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import { exportReport, type CsvColumn } from '../../lib/csv';
import {
  assignBhwToPurok,
  fetchAccounts,
  fetchActivePuroks,
  fetchBarangayScope,
  filterAccounts,
  managesAccount,
  setProfileActive,
  type AccountRow,
  type AdminFilters,
} from '../../services/adminData';
import type { Purok, UserRole } from '../../types/database';
import { Button } from '../common/Button';
import { SelectField, TextAreaField } from '../common/FormField';
import { Modal } from '../common/Modal';
import { ErrorState } from '../common/StateMessage';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

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
 * What each role is called on screen. `admin` is the RHU account that reads every
 * barangay, `barangay_admin` runs one, and the labels keep them apart.
 */
const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin / LGU',
  barangay_admin: 'Barangay Admin',
  bhw: 'Barangay Health Worker',
};

/** Which dialog is open, and for whom. One value, so two cannot be open at once. */
type PendingAction = { kind: 'assign' | 'active'; account: AccountRow } | null;

type AccountsTableProps = {
  /**
   * Who is looking, which decides which rows get controls. An `admin` manages
   * every account; a `barangay_admin` manages the health workers in their own
   * barangay and nothing else. The rule is enforced in
   * `private.assert_can_manage_bhw()`; this only decides which buttons to draw.
   */
  role: UserRole | null;
  /** The page's filter drawer, applied in memory over the accounts already read. */
  filters: AdminFilters;
};

/**
 * Accounts and their current purok, read from `public.profiles` — the same table
 * the route guard and every RLS helper read.
 *
 * The two mutations go through `admin_set_profile_active` and
 * `admin_assign_bhw_to_purok`, never a direct table write: each asserts an active
 * admin and writes the audit event in the same transaction. Both take a reason,
 * which the form requires.
 *
 * Creating an account and resetting a password are absent: both need the auth user
 * to exist first, which a browser holding a publishable key cannot do.
 */
export function AccountsTable({ role, filters }: AccountsTableProps) {
  // Whether the Actions column is drawn at all, and whether this row gets buttons.
  // Two questions: a barangay administrator owns the column but not most rows.
  const managesAnyone = role === 'admin' || role === 'barangay_admin';
  const manages = (account: AccountRow) => managesAccount(role, account.profile.role);

  const [pending, setPending] = useState<PendingAction>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{
    rows: AccountRow[];
    puroks: Purok[];
    error: string | null;
    settledFor: number;
  }>({ rows: [], puroks: [], error: null, settledFor: -1 });

  // `loading` is the difference between the read this render wants and the one the
  // state last settled against, the same shape `useAdminData` uses.
  const { rows, puroks, error } = result;
  const loading = result.settledFor !== reloadToken;
  // What the drawer left. `rows` stays the whole set, so the count can say how
  // much was filtered away and a mutation refreshes against everything.
  const visible = filterAccounts(rows, filters);

  useEffect(() => {
    let current = true;

    Promise.all([fetchAccounts(), fetchActivePuroks()])
      .then(([accounts, activePuroks]) => {
        if (current) {
          setResult({ rows: accounts, puroks: activePuroks, error: null, settledFor: reloadToken });
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setResult((previous) => ({
            ...previous,
            error: cause instanceof Error ? cause.message : 'Could not read accounts.',
            settledFor: reloadToken,
          }));
        }
      });

    return () => {
      current = false;
    };
  }, [reloadToken]);

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
      // A BHW with no active assignment can neither read nor write a field row, so
      // an empty cell here explains a device that signs in and sees nothing.
      render: (account) =>
        account.purokName ?? (account.profile.role === 'bhw' ? 'None — cannot sync' : 'Not purok-scoped'),
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

  if (managesAnyone) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      // Empty for a row this account may look at but not touch.
      render: (account) =>
        manages(account) ? (
          <div className="table-actions">
            {/* An admin covers every purok by policy, so there is no assignment to
                make for one — the button would open a form whose only outcome is
                an error from the RPC. */}
            {account.profile.role === 'bhw' ? (
              <Button variant="ghost" onClick={() => setPending({ kind: 'assign', account })}>
                {account.purokName ? 'Reassign' : 'Assign purok'}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setPending({ kind: 'active', account })}>
              {account.profile.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        ) : null,
    });
  }

  // The scope is read at export time rather than held in state, so the file cannot
  // name a barangay the session has since moved off.
  async function exportAccounts() {
    exportReport(
      {
        title: 'Accounts',
        barangay: (await fetchBarangayScope()).label,
        from: 'all dates',
        to: 'all dates',
        // The drawer's filters, named on the file, so an export of a narrowed
        // list does not read later as the whole account list.
        filters: [
          ...(filters.accountRole ? [{ label: 'Role', value: titleCase(filters.accountRole) }] : []),
          ...(filters.accountActive ? [{ label: 'Account state', value: titleCase(filters.accountActive) }] : []),
        ],
      },
      visible,
      exportColumns,
    );
  }

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <Button variant="ghost" onClick={() => void exportAccounts()} disabled={loading || !visible.length}>
          Export CSV
        </Button>
      </TableToolbar>

      {error ? <ErrorState title="Could not read accounts" text={error} /> : null}

      <Table
        columns={columns}
        rows={visible}
        getRowKey={(account) => account.profile.user_id}
        emptyTitle={loading ? 'Reading accounts' : 'No accounts found'}
        emptyText={
          loading
            ? 'One moment.'
            : rows.length
              ? 'No account matches the filters. Widen them in the drawer above.'
              : 'Accounts are created through the administrative RPCs; see the foundation bootstrap procedure.'
        }
      />

      <TableMeta shown={visible.length} total={rows.length} label="account" />

      {/* Keyed on the account and the action so the fields reset between
          openings: a reason typed for one account must never be carried into
          the dialog for the next. */}
      {pending ? (
        <AccountActionForm
          key={`${pending.kind}:${pending.account.profile.user_id}`}
          pending={pending}
          puroks={puroks}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null);
            setReloadToken((token) => token + 1);
          }}
        />
      ) : null}
    </div>
  );
}

type AccountActionFormProps = {
  pending: NonNullable<PendingAction>;
  puroks: Purok[];
  onClose: () => void;
  onDone: () => void;
};

/** One dialog for both mutations: a reason, plus a purok when it is an assignment. */
function AccountActionForm({ pending, puroks, onClose, onDone }: AccountActionFormProps) {
  const { kind, account } = pending;
  const deactivating = account.profile.is_active;
  const [purokId, setPurokId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const title =
    kind === 'assign'
      ? `Assign ${account.profile.full_name} to a purok`
      : `${deactivating ? 'Deactivate' : 'Reactivate'} ${account.profile.full_name}`;

  // Submit is withheld rather than validated on click, so the missing reason (and
  // purok, on an assignment) shows before the round trip.
  const ready = reason.trim().length > 0 && (kind !== 'assign' || purokId !== '');

  async function submit() {
    setBusy(true);
    setFailure(null);

    try {
      if (kind === 'assign') {
        await assignBhwToPurok(account.profile.user_id, purokId, reason.trim());
      } else {
        await setProfileActive(account.profile.user_id, !deactivating, reason.trim());
      }

      onDone();
    } catch (cause: unknown) {
      setFailure(cause instanceof Error ? cause.message : 'The change was not applied.');
      setBusy(false);
    }
  }

  return (
    <Modal open title={title} onClose={onClose}>
      <p className="muted">
        {kind === 'assign'
          ? 'A BHW reads and writes field records for one purok at a time. Assigning a new purok ends the current assignment.'
          : deactivating
            ? 'A deactivated account can still sign in, but every RLS helper starts from an active profile — so it reads nothing and writes nothing.'
            : 'The account regains the access its role and purok assignment allow.'}
      </p>

      {kind === 'assign' ? (
        <SelectField label="Purok" value={purokId} onChange={(event) => setPurokId(event.target.value)}>
          <option value="">Select a purok</option>
          {puroks.map((purok) => (
            <option key={purok.purok_id} value={purok.purok_id}>
              {purok.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <TextAreaField
        label="Reason"
        hint="Recorded in the audit trail beside your name and the time."
        rows={3}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />

      {failure ? <ErrorState title="The change was not applied" text={failure} /> : null}

      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {/* The confirm button names the act, not the mechanism. "Apply change"
            reads the same for an assignment and for cutting an account off from
            every field record it can reach. */}
        <Button variant={kind === 'active' && deactivating ? 'danger' : 'primary'} onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? 'Applying…' : kind === 'assign' ? 'Assign purok' : deactivating ? 'Deactivate account' : 'Reactivate account'}
        </Button>
      </div>
    </Modal>
  );
}
