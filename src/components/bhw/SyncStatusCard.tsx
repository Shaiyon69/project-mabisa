import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { formatDate } from '../../lib/utils';
import { useBhwLanguage } from '../../app/bhwLanguage';
import type { DeadLetterEntry, LocalTableName } from '../../services/localDatabase';
import type { SyncStatus } from '../../services/syncService';

type SyncStatusCardProps = {
  isOnline: boolean;
  syncStatus: SyncStatus;
  /** Present only on a genuine failure. Drives the "Action Required" banner. */
  syncError: string | null;
  /** When the queue last drained, ISO 8601, or null if it never has on this device. */
  lastSyncAt: string | null;
  pendingQueueCount: number;
  deadLetterEntries: DeadLetterEntry[];
  syncingManually: boolean;
  onManualSync: () => Promise<void>;
  onRetryDeadLetters: () => Promise<void>;
};

// Raw SyncStatus values are engine vocabulary. Exhaustive over the union, so a
// new status is a build error here rather than untranslated jargon on screen.
const statusLabels: Record<SyncStatus, string> = {
  idle: 'Idle',
  offline: 'Offline',
  syncing: 'Syncing',
  synced: 'Synced',
  deferred: 'Waiting to retry',
  failed: 'Failed',
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

/** Date and time — a BHW needs to know if this morning's records have left the phone, not just the day. `formatDate` carries no clock. */
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
}: SyncStatusCardProps) {
  const { t } = useBhwLanguage();

  // Exact status match, not a substring of the message — a `deferred` backoff must not paint the card red.
  const isError = syncStatus === 'failed';
  const isPending = pendingQueueCount > 0;
  const setAsideCount = deadLetterEntries.length;
  const hasSetAside = setAsideCount > 0;

  const syncedLabel = t(isError ? 'Sync Failed' : hasSetAside ? 'Needs Review' : isPending ? 'Pending Sync' : 'Synced');
  const badgeTone = isError ? 'danger' : (!isOnline || isPending || hasSetAside) ? 'warning' : 'success';

  // Disabled only while syncing or offline — not on an empty queue, so a BHW can pull updates anytime.
  const isButtonDisabled = syncingManually || !isOnline;

  return (
    <Card className="sync-hero">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{t('Device status')}</p>
          <h2>{t(isOnline ? 'Ready to sync records' : 'Encoding works offline')}</h2>
        </div>
        <Badge label={syncedLabel} tone={badgeTone} />
      </div>

      <div className="status-strip">
        <StatusCard
          label={t('Connection')}
          value={t(isOnline ? 'Online' : 'Offline')}
          tone={isOnline ? 'success' : 'warning'}
        />
        <StatusCard
          label={t('Sync status')}
          value={t(statusLabels[syncStatus])}
          tone={isError ? 'danger' : 'info'}
        />
        <StatusCard
          label={t('Queue')}
          value={`${pendingQueueCount}`}
          tone={isPending ? 'warning' : 'success'}
        />
      </div>

      <p className="muted sync-last">
        {lastSyncAt
          ? `${t('Last synced')} ${formatSyncMoment(lastSyncAt)}`
          : t('This device has not completed a sync yet.')}
      </p>

      {isError && (
        <p className="alert sync-alert">
          <strong>{t('Action Required:')}</strong> {syncError ?? t('Sync failed. Try again.')}
        </p>
      )}

      {hasSetAside && (
        <section className="sync-quarantine" aria-label="Changes set aside">
          <div className="sync-quarantine-heading">
            <div>
              <p className="eyebrow">Set aside after repeated failures</p>
              <strong>
                {setAsideCount} change{setAsideCount === 1 ? '' : 's'} still on this device
              </strong>
            </div>
            <Badge label="Needs Review" tone="warning" />
          </div>

          <p className="muted">
            Nothing was deleted. These were moved out of the queue so the rest of your records could sync, and can be
            sent again once the cause is fixed.
          </p>

          <ul className="sync-quarantine-list">
            {deadLetterEntries.map((entry) => (
              <li key={entry.dead_letter_id}>
                <span>{recordLabels[entry.target_table]}</span>
                <small>
                  Saved {formatDate(entry.created_at)} • {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'}
                </small>
                <small className="sync-quarantine-error">{entry.last_error ?? 'Unknown error'}</small>
              </li>
            ))}
          </ul>

          <Button variant="secondary" onClick={onRetryDeadLetters} disabled={isButtonDisabled}>
            {syncingManually ? 'Retrying...' : 'Try these again'}
          </Button>
        </section>
      )}

      <div className="sync-actions">
        <Button onClick={onManualSync} disabled={isButtonDisabled}>
          {/* Dynamic Button Text explains exactly what the click will do */}
          {syncingManually
            ? t('Syncing...')
            : !isOnline
              ? t('Offline')
              : isError
                ? t('Retry Sync')
                : isPending
                  ? t('Push Local Changes')
                  : t('Check for Updates')}
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
