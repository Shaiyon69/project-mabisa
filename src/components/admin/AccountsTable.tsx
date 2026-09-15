import { useEffect, useState } from 'react';
import { formatDate } from '../../lib/utils';
import {
  assignBhwToPurok,
  canAssignPurok,
  createAccount,
  fetchAccountPage,
  fetchActiveBarangays,
  fetchActivePuroks,
  fetchBarangayScope,
  fetchBarangaysMissingAdmin,
  setProfileActive,
  type AccountRow,
  type AdminFilters,
} from '../../services/adminData';
import { useServerPage } from '../../hooks/useServerPage';
import type { Barangay, Purok, UserRole } from '../../types/database';
import { Button } from '../common/Button';
import { FormField, SelectField, TextAreaField } from '../common/FormField';
import { Modal } from '../common/Modal';
import { ErrorState, WarningState } from '../common/StateMessage';
import { Table, TableBadge, TableMeta, TablePager, TableToolbar, type TableColumn } from '../common/Table';

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
   * Who is looking, which decides whose accounts the tab is: an `admin` appoints
   * barangay administrators, a `barangay_admin` runs the health workers in their
   * own barangay. The rules are enforced in `private.assert_can_manage_bhw()` and
   * `private.assert_admin()`; this only decides what is drawn.
   */
  role: UserRole | null;
  /** The page's filter drawer, sent with the page read. */
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
 * Creating an account goes through the `create-account` function, which holds the
 * service role a browser cannot: writing to `auth.users` is not a publishable-key
 * operation. Resetting a password is still absent.
 */
export function AccountsTable({ role, filters }: AccountsTableProps) {
  const managesAnyone = role === 'admin' || role === 'barangay_admin';
  // Every row on this tab holds one role, so the purok columns and the purok
  // button are the same question asked of the table and of a row.
  const assignsAnyone = canAssignPurok(role, 'bhw');
  const assigns = (account: AccountRow) => canAssignPurok(role, account.profile.role);

  const [pending, setPending] = useState<PendingAction>(null);
  const [creating, setCreating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // The lists the dialogs and the missing-administrator warning need, beside the paged accounts.
  const [lookups, setLookups] = useState<{
    puroks: Purok[];
    barangays: Barangay[];
    /** The session's own barangay, which a new health worker is created into. Null for the RHU. */
    sessionBarangayId: string | null;
    /** Only the RHU can appoint an administrator, so only the RHU is told one is missing. */
    unadministered: Barangay[];
    error: string | null;
  }>({ puroks: [], barangays: [], sessionBarangayId: null, unadministered: [], error: null });
  const { puroks, barangays, sessionBarangayId, unadministered } = lookups;

  const filtered = Boolean(filters.accountRole || filters.accountActive || filters.barangayId || filters.purokId);
  const scopeKey = [role, filters.accountRole, filters.accountActive, filters.barangayId, filters.purokId].join('|');
  const { rows, total, error: pageError, loading, page, pageCount, setPage, offset } = useServerPage(
    scopeKey,
    (limit, start) => fetchAccountPage(role, filters, limit, start),
    { reloadToken },
  );
  const error = pageError ?? lookups.error;

  useEffect(() => {
    let current = true;

    Promise.all([
      fetchActivePuroks(),
      fetchActiveBarangays(),
      fetchBarangayScope(),
      role === 'admin' ? fetchBarangaysMissingAdmin() : Promise.resolve([]),
    ])
      .then(([activePuroks, activeBarangays, scope, missing]) => {
        if (current) {
          setLookups({
            puroks: activePuroks,
            barangays: activeBarangays,
            sessionBarangayId: scope.barangayId,
            unadministered: missing,
            error: null,
          });
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setLookups((previous) => ({ ...previous, error: cause instanceof Error ? cause.message : 'Could not read accounts.' }));
        }
      });

    return () => {
      current = false;
    };
  }, [reloadToken, role]);

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
    // A barangay administrator holds no purok, so the RHU's tab has no column for
    // one. On a health worker an empty cell is the answer: without an assignment
    // they can neither read nor write a field row, which explains a device that
    // signs in and sees nothing.
    ...(assignsAnyone
      ? [
          {
            key: 'assigned-purok',
            header: 'Assigned Purok',
            render: (account: AccountRow) => account.purokName ?? 'None — cannot receive records',
          },
          {
            key: 'assigned-since',
            header: 'Assigned Since',
            render: (account: AccountRow) => (account.assignedSince ? formatDate(account.assignedSince) : '—'),
          },
        ]
      : []),
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
      render: (account) => (
        <div className="table-actions">
          {/* The barangay administrator's alone: the RHU may not assign a purok,
              so the button would open a form whose only outcome is an error. */}
          {assigns(account) ? (
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

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        {managesAnyone ? (
          <Button onClick={() => setCreating(true)} disabled={loading}>
            {role === 'admin' ? 'Create account' : 'Create health worker'}
          </Button>
        ) : null}
      </TableToolbar>

      {error ? <ErrorState title="Could not read accounts" text={error} /> : null}

      {/* Named, not counted: the point of the warning is which barangay to appoint
          someone for. Health workers there can be created and never assigned. */}
      {unadministered.length ? (
        <WarningState
          title={
            unadministered.length === 1
              ? '1 barangay has no administrator'
              : `${unadministered.length} barangays have no administrator`
          }
          text={`${unadministered.map((barangay) => barangay.name).join(', ')} — nobody there can assign a health worker to a purok, so nobody there can record anything.`}
        />
      ) : null}

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(account) => account.profile.user_id}
        numbered
        startIndex={offset}
        busy={loading}
        emptyTitle={loading ? 'Loading the accounts' : 'No accounts found'}
        emptyText={
          loading
            ? 'One moment.'
            : filtered
              ? 'No account matches the filters. Widen them in the drawer above.'
              : role === 'admin'
                ? 'No barangay administrator yet. Create one with the button above.'
                : 'No health worker in this barangay yet. Create one with the button above, then assign them a purok.'
        }
      />

      <TableMeta shown={rows.length} total={total} label={role === 'admin' ? 'barangay administrators' : 'health workers'} />
      {pageCount > 1 ? <TablePager page={page} pageCount={pageCount} onPage={setPage} disabled={loading} /> : null}

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

      {creating ? (
        <CreateAccountForm
          viewer={role}
          barangays={barangays}
          sessionBarangayId={sessionBarangayId}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setReloadToken((token) => token + 1);
          }}
        />
      ) : null}
    </div>
  );
}

type CreateAccountFormProps = {
  viewer: UserRole | null;
  barangays: Barangay[];
  sessionBarangayId: string | null;
  onClose: () => void;
  onDone: () => void;
};

/**
 * A new login and its profile. The RHU appoints anybody; a barangay administrator
 * creates health workers for their own barangay, which is the whole of their lane
 * and so is not a choice the form offers. `admin_create_profile` enforces both.
 */
function CreateAccountForm({ viewer, barangays, sessionBarangayId, onClose, onDone }: CreateAccountFormProps) {
  const appoints = viewer === 'admin';
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(appoints ? 'barangay_admin' : 'bhw');
  const [barangayId, setBarangayId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // An RHU account is not confined to a barangay and the RPC refuses one with a
  // barangay set; every other role must name theirs. A barangay administrator has
  // only their own to give, so there is nothing to pick.
  const needsBarangay = role !== 'admin';
  const chosenBarangay = appoints ? barangayId : sessionBarangayId ?? '';
  const ready =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    (!needsBarangay || chosenBarangay !== '');

  async function submit() {
    setBusy(true);
    setFailure(null);

    try {
      await createAccount({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        role,
        barangayId: needsBarangay ? chosenBarangay : null,
      });

      onDone();
    } catch (cause: unknown) {
      setFailure(cause instanceof Error ? cause.message : 'The account was not created.');
      setBusy(false);
    }
  }

  return (
    <Modal open title={appoints ? 'Create an account' : 'Create a health worker'} onClose={onClose}>
      <p className="muted">
        {appoints
          ? 'The person signs in with this email and password. Give the password to them directly and have them change it.'
          : 'A health worker for your barangay. They sign in with this email and password — hand it to them directly, then assign them a purok.'}
      </p>

      <FormField label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
      <FormField
        label="Email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <FormField
        label="Initial password"
        type="text"
        autoComplete="off"
        hint="At least 8 characters. It is shown here so it can be written down and handed over."
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {appoints ? (
        <SelectField label="Role" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
          <option value="barangay_admin">{ROLE_LABELS.barangay_admin}</option>
          <option value="bhw">{ROLE_LABELS.bhw}</option>
          <option value="admin">{ROLE_LABELS.admin}</option>
        </SelectField>
      ) : null}

      {appoints && needsBarangay ? (
        <SelectField
          label="Barangay"
          hint="A health worker with no barangay cannot be reached by any administrator."
          value={barangayId}
          onChange={(event) => setBarangayId(event.target.value)}
        >
          <option value="">Select a barangay</option>
          {barangays.map((barangay) => (
            <option key={barangay.barangay_id} value={barangay.barangay_id}>
              {barangay.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      {failure ? <ErrorState title="The account was not created" text={failure} /> : null}

      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? 'Creating…' : appoints ? 'Create account' : 'Create health worker'}
        </Button>
      </div>
    </Modal>
  );
}

type AccountActionFormProps = {
  pending: NonNullable<PendingAction>;
  puroks: Purok[];
  onClose: () => void;
  onDone: () => void;
};

/** The reasons an action is usually taken, offered before the free-text box. */
const REASONS: Record<'assign' | 'deactivate' | 'reactivate', string[]> = {
  assign: [
    'New health worker',
    'Reassigned to another purok',
    'Covering for another health worker',
    'Rebalancing workload',
    'Returned from leave',
  ],
  deactivate: ['Resigned', 'On extended leave', 'Transferred out of the barangay', 'End of contract', 'No longer active in the field'],
  reactivate: ['Returned from leave', 'Rehired', 'Reinstated after review'],
};

const OTHER = 'Other';

/** One dialog for both mutations: a reason, plus a purok when it is an assignment. */
function AccountActionForm({ pending, puroks, onClose, onDone }: AccountActionFormProps) {
  const { kind, account } = pending;
  const deactivating = account.profile.is_active;
  const [purokId, setPurokId] = useState('');
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const offered = REASONS[kind === 'assign' ? 'assign' : deactivating ? 'deactivate' : 'reactivate'];
  // The audit trail takes one string either way: the picked reason, or what was typed under "Other".
  const recorded = choice === OTHER ? reason : choice;

  const title =
    kind === 'assign'
      ? `Assign ${account.profile.full_name} to a purok`
      : `${deactivating ? 'Deactivate' : 'Reactivate'} ${account.profile.full_name}`;

  // Submit is withheld rather than validated on click, so the missing reason (and
  // purok, on an assignment) shows before the round trip.
  const ready = recorded.trim().length > 0 && (kind !== 'assign' || purokId !== '');

  async function submit() {
    setBusy(true);
    setFailure(null);

    try {
      if (kind === 'assign') {
        await assignBhwToPurok(account.profile.user_id, purokId, recorded.trim());
      } else {
        await setProfileActive(account.profile.user_id, !deactivating, recorded.trim());
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

      <SelectField
        label="Reason"
        hint="Recorded in the audit trail beside your name and the time."
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">Select a reason</option>
        {offered.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
        <option value={OTHER}>{OTHER}</option>
      </SelectField>

      {choice === OTHER ? (
        <TextAreaField
          label="Reason in your own words"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      ) : null}

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
