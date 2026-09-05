import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { formatDate } from '../../lib/utils';
import type { DeadLetterEntry, LocalTableName } from '../../services/localDatabase';
import type { SyncStatus } from '../../services/syncService';

type SyncStatusCardProps = {
  isOnline: boolean;
  syncStatus: SyncStatus;
  /** Present only on a genuine failure. Drives the "Please check" banner. */
  syncError: string | null;
  /** When the queue last drained, ISO 8601, or null if it never has on this device. */
  lastSyncAt: string | null;
  pendingQueueCount: number;
  deadLetterEntries: DeadLetterEntry[];
  syncingManually: boolean;
  onManualSync: () => Promise<void>;
  onRetryDeadLetters: () => Promise<void>;
  /** Returns to the sign-in screen. Local records and the queue survive it. */
  onSignInAgain: () => Promise<void>;
};

// Exhaustive over the union, so a new status is a build error here rather than
// engine vocabulary on screen.
const statusLabels: Record<SyncStatus, string> = {
  idle: 'Nothing waiting',
  offline: 'No signal',
  syncing: 'Sending...',
  synced: 'All sent',
  deferred: 'Will try again',
  failed: 'Could not send',
  unauthenticated: 'Sign in needed',
};

// What each queued row means to a BHW, who has no reason to know table names.
const recordLabels: Record<LocalTableName, string> = {
  households: 'Household profile',
  individuals: 'Resident profile',
  health_assessments: 'Health assessment',
  inventory_items: 'Inventory item',
  supply_disbursements: 'Supply release',
};

/** Date and time, since "this morning" is the question here and `formatDate` carries no clock. */
function formatSyncMoment(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function SyncStatusCard({
  isOnline,
  syncStatus,
  syncError,
  lastSyncAt,
  pendingQueueCount,
  deadLetterEntries,
  syncingManually,
  onManualSync,
  onRetryDeadLetters,
  onSignInAgain,
}: SyncStatusCardProps) {
  // Exact status match, not a substring of the message — a `deferred` backoff must not paint the card red.
  const isError = syncStatus === 'failed';
  // A device offline for days comes back with a refresh token the server no longer
  // accepts. Nothing is lost, but nothing leaves the phone until the BHW signs in
  // again, so the way back has to be here rather than behind the logout button.
  const needsSignIn = syncStatus === 'unauthenticated';
  const isPending = pendingQueueCount > 0;
  const setAsideCount = deadLetterEntries.length;
  const hasSetAside = setAsideCount > 0;

  const syncedLabel = isError ? 'Could not send' : hasSetAside ? 'Needs checking' : isPending ? 'Waiting to send' : 'All sent';
  // The engine's last run is not the whole answer. Rows queued since it finished
  // are still on the phone, and "Synced" beside a queue of four reads as a
  // promise the app has not kept.
  const statusValue = isPending && (syncStatus === 'synced' || syncStatus === 'idle') ? 'Waiting to send' : statusLabels[syncStatus];
  const badgeTone = isError ? 'danger' : (!isOnline || isPending || hasSetAside) ? 'warning' : 'success';

  // Disabled only while syncing or offline — not on an empty queue, so a BHW can pull updates anytime.
  const isButtonDisabled = syncingManually || !isOnline;

  return (
    <Card className="sync-hero">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">This phone</p>
          <h2>{isOnline ? 'This phone has signal' : 'You can keep working without signal'}</h2>
        </div>
        <Badge label={syncedLabel} tone={badgeTone} />
      </div>

      <div className="status-strip">
        <StatusCard
          label="Signal"
          value={isOnline ? 'Yes' : 'None'}
          tone={isOnline ? 'success' : 'warning'}
        />
        <StatusCard
          label="Records"
          value={statusValue}
          tone={isError ? 'danger' : isPending ? 'warning' : 'info'}
        />
        <StatusCard
          label="Records waiting"
          value={`${pendingQueueCount}`}
          tone={isPending ? 'warning' : 'success'}
        />
      </div>

      <p className="muted sync-last">
        {lastSyncAt
          ? `Last sent ${formatSyncMoment(lastSyncAt)}`
          : 'Nothing has been sent from this phone yet.'}
      </p>

      {needsSignIn && (
        <section className="sync-signin" aria-label="Sign in needed">
          <p className="alert sync-alert">
            <strong>Sign in needed:</strong>{' '}
            This phone was signed out. Everything you saved is still here, and will be sent once you sign in again.
          </p>
          <Button onClick={() => void onSignInAgain()}>Sign in again</Button>
        </section>
      )}

      {isError && (
        <p className="alert sync-alert">
          <strong>Please check:</strong> {syncError ?? 'The records could not be sent. Try again.'}
        </p>
      )}

      {hasSetAside && (
        <section className="sync-quarantine" aria-label="Changes set aside">
          <div className="sync-quarantine-heading">
            <div>
              <p className="eyebrow">Could not be sent after several tries</p>
              <strong>
                {setAsideCount} record{setAsideCount === 1 ? '' : 's'} still on this phone
              </strong>
            </div>
            <Badge label="Needs checking" tone="warning" />
          </div>

          <p className="muted">
            Nothing was deleted. These were set aside so the rest of your records could go through, and can be sent
            again once the problem is fixed.
          </p>

          <ul className="sync-quarantine-list">
            {deadLetterEntries.map((entry) => (
              <li key={entry.dead_letter_id}>
                <span>{recordLabels[entry.target_table]}</span>
                <small>
                  Saved {formatDate(entry.created_at)} • tried {entry.attempts} time{entry.attempts === 1 ? '' : 's'}
                </small>
                <small className="sync-quarantine-error">{entry.last_error ?? 'Unknown error'}</small>
              </li>
            ))}
          </ul>

          <Button variant="secondary" onClick={onRetryDeadLetters} disabled={isButtonDisabled}>
            {syncingManually ? 'Sending...' : 'Try these again'}
          </Button>
        </section>
      )}

      <div className="sync-actions">
        <Button onClick={onManualSync} disabled={isButtonDisabled}>
          {/* Dynamic Button Text explains exactly what the click will do */}
          {syncingManually
            ? 'Sending...'
            : !isOnline
              ? 'No signal'
              : isError
                ? 'Try again'
                : isPending
                  ? 'Send now'
                  : 'Get latest'}
        </Button>
      </div>
    </Card>
  );
}

function StatusCard({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'danger' | 'info' }) {
  return (
    <div className={`status-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
