import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { titleCase } from '../../lib/utils';

type SyncStatusCardProps = {
  isOnline: boolean;
  syncStatus: string;
  pendingQueueCount: number;
  syncingManually: boolean;
  onManualSync: () => Promise<void>;
};

export function SyncStatusCard({ isOnline, syncStatus, pendingQueueCount, syncingManually, onManualSync }: SyncStatusCardProps) {
  const syncedLabel = pendingQueueCount > 0 ? 'Pending Sync' : syncStatus === 'synced' ? 'Synced' : titleCase(syncStatus);

  return (
    <Card className="sync-hero">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Device status</p>
          <h2>{isOnline ? 'Ready to sync records' : 'Encoding works offline'}</h2>
        </div>
        <Badge label={syncedLabel} tone={!isOnline || pendingQueueCount > 0 ? 'warning' : syncStatus === 'failed' ? 'danger' : 'success'} />
      </div>

      <div className="status-strip">
        <StatusCard label="Connection" value={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'success' : 'warning'} />
        <StatusCard label="Sync status" value={titleCase(syncStatus)} tone={syncStatus === 'failed' ? 'danger' : 'info'} />
        <StatusCard label="Queue" value={`${pendingQueueCount}`} tone={pendingQueueCount ? 'warning' : 'success'} />
      </div>

      <Button onClick={onManualSync} disabled={syncingManually}>
        {syncingManually ? 'Syncing Records' : 'Sync Now'}
      </Button>
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
