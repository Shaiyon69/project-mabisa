import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { formatDate, titleCase } from '../../lib/utils';
import type { DeadLetterEntry, LocalTableName } from '../../services/localDatabase';

type SyncStatusCardProps = {
  isOnline: boolean;
  syncStatus: string;
  pendingQueueCount: number;
  deadLetterEntries: DeadLetterEntry[];
  syncingManually: boolean;
  onManualSync: () => Promise<void>;
  onRetryDeadLetters: () => Promise<void>;
};

// Raw SyncStatus values are engine vocabulary. Only these need translating —
// anything else arriving here is already a sentence and falls through to titleCase.
const statusLabels: Record<string, string> = {
  idle: 'Idle',
  offline: 'Offline',
  syncing: 'Syncing',
  synced: 'Synced',
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

export function SyncStatusCard({
  isOnline,
  syncStatus,
  pendingQueueCount,
  deadLetterEntries,
  syncingManually,
  onManualSync,
  onRetryDeadLetters,
}: SyncStatusCardProps) {

  const isError = syncStatus.toLowerCase().includes('error') || syncStatus.toLowerCase().includes('fail');
  const isPending = pendingQueueCount > 0;
  const setAsideCount = deadLetterEntries.length;
  const hasSetAside = setAsideCount > 0;

  const syncedLabel = isError ? 'Sync Failed' : hasSetAside ? 'Needs Review' : isPending ? 'Pending Sync' : 'Synced';
  const badgeTone = isError ? 'danger' : (!isOnline || isPending || hasSetAside) ? 'warning' : 'success';

  // FIX: The button is now ONLY disabled if the app is actively syncing,
  // or if the device has no internet connection.
  // We removed the "empty queue" restriction so BHWs can pull updates anytime.
  const isButtonDisabled = syncingManually || !isOnline;

  return (
    <Card className="sync-hero">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Device status</p>
          <h2>{isOnline ? 'Ready to sync records' : 'Encoding works offline'}</h2>
        </div>
        <Badge label={syncedLabel} tone={badgeTone} />
      </div>

      <div className="status-strip">
        <StatusCard
          label="Connection"
          value={isOnline ? 'Online' : 'Offline'}
          tone={isOnline ? 'success' : 'warning'}
        />
        <StatusCard
          label="Sync status"
          value={isError ? 'Failed' : statusLabels[syncStatus] ?? titleCase(syncStatus)}
          tone={isError ? 'danger' : 'info'}
        />
        <StatusCard
          label="Queue"
          value={`${pendingQueueCount}`}
          tone={isPending ? 'warning' : 'success'}
        />
      </div>

      {isError && (
        <p className="alert sync-alert">
          <strong>Action Required:</strong> {syncStatus}
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
            ? 'Syncing...'
            : !isOnline
              ? 'Offline'
              : isError
                ? 'Retry Sync'
                : isPending
                  ? 'Push Local Changes'
                  : 'Check for Updates'}
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
