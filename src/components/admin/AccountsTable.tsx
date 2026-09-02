import { useEffect, useState } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import { buildReportCsv, downloadCsv, reportFileName, type CsvColumn } from '../../lib/csv';
import {
  assignBhwToPurok,
  fetchAccounts,
  fetchActivePuroks,
  fetchBarangayScope,
  filterAccounts,
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
 * What each role is called on screen. `admin` is the RHU or LGU account that
 * reads every barangay; `barangay_admin` runs one. They are different scopes and
 * different powers, so a table that showed both as "Admin" would be hiding the
 * distinction that decides what each of them can actually do.
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
   * Every `admin_*` RPC asserts `is_admin()`, so a `barangay_admin` gets the
   * table read-only. Hiding the buttons is not the enforcement — the function
   * is — but offering a control that can only return an error is worse than
   * offering none.
   */
  canManage: boolean;
  /**
   * The page's filter drawer. Applied in memory rather than in the query: this
   * screen reads every account the session may see in one go, and a role or a
   * barangay is a narrowing of that list, not a different read.
   */
  filters: AdminFilters;
};

/**
 * Accounts and their current purok, read from `public.profiles` — the same table
 * the route guard and every RLS helper read, so what this screen shows about an
 * account is what the database will actually enforce for it.
 *
 * The two mutations here go through `admin_set_profile_active` and
 * `admin_assign_bhw_to_purok`, never a direct table write: the RPCs assert an
 * active admin and write the audit event in the same transaction, which is why
 * the foundation slice withholds table-level grants in the first place. Both
 * take a reason, and the form requires it for the same reason the function does
 * — an audit row is worth nothing if every entry says "update".
 *
 * Creating an account and resetting a password are deliberately still absent.
 * Both need the auth user to exist first, which is a service-role operation and
 * cannot happen from a browser holding a publishable key; see the foundation
 * bootstrap procedure.
 */
export function AccountsTable({ canManage, filters }: AccountsTableProps) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{
    rows: AccountRow[];
    puroks: Purok[];
    error: string | null;
    settledFor: number;
  }>({ rows: [], puroks: [], error: null, settledFor: -1 });

  // `loading` is the difference between the read this render wants and the one
  // the state was last settled against, the same shape `useAdminData` uses. A
  // flag set inside the effect would mark the screen busy a render late — and
  // is what `react-hooks/set-state-in-effect` reports.
  const { rows, puroks, error } = result;
  const loading = result.settledFor !== reloadToken;
  // What the drawer left. `rows` stays the whole set so the count below can say
  // how much was filtered away, and so a mutation still refreshes against
  // everything rather than against the current narrowing.
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
      // A BHW with no active assignment can neither read nor write a field row
      // under the purok policies, so an empty cell here is the reason a device
      // that signs in successfully still sees nothing.
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

  if (canManage) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      render: (account) => (
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
      ),
    });
  }

  // The scope is read at export time rather than held in state: it is one RPC, it
  // is wanted only when a file is actually produced, and a CSV that names the wrong
  // barangay is worse than one that takes a moment longer to build.
  async function exportAccounts() {
    downloadCsv(
      reportFileName('Accounts'),
      buildReportCsv(
        {
          title: 'Accounts',
          barangay: await fetchBarangayScope(),
          from: 'all dates',
          to: 'all dates',
          // The drawer's filters, named on the file. The export is of what is
          // on screen, so a file taken while one role was selected must not
          // read later as the whole account list.
          filters: [
            ...(filters.accountRole ? [{ label: 'Role', value: titleCase(filters.accountRole) }] : []),
            ...(filters.accountActive ? [{ label: 'Account state', value: titleCase(filters.accountActive) }] : []),
          ],
        },
        visible,
        exportColumns,
      ),
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

/**
 * One dialog for both mutations. They ask almost the same question — a reason,
 * and for an assignment also a purok — so splitting them would duplicate the
 * submit, error and busy handling to save a single conditional field.
 */
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

  // Submit is withheld rather than validated on click: the RPC requires a reason,
  // and an assignment also a purok, so a disabled button says so before the round
  // trip rather than after it.
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
