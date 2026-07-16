import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { titleCase } from '../../lib/utils';

type SyncStatusCardProps = {
  isOnline: boolean;
  syncStatus: string;
  pendingQueueCount: number;
  syncingManually: boolean;
  onManualSync: () => Promise<void>;
};

export function SyncStatusCard({ 
  isOnline, 
  syncStatus, 
  pendingQueueCount, 
  syncingManually, 
  onManualSync 
}: SyncStatusCardProps) {
  
  // 1. Smarter Error Detection
  const isError = syncStatus.toLowerCase().includes('error') || syncStatus.toLowerCase().includes('fail');
  const isPending = pendingQueueCount > 0;

  // 2. Dynamic Badge Labeling
  const syncedLabel = isError ? 'Sync Failed' : isPending ? 'Pending Sync' : 'Synced';
  const badgeTone = isError ? 'danger' : (!isOnline || isPending) ? 'warning' : 'success';

  // 3. Strict Button Guardrails
  // Disable if: currently syncing OR (offline with no queue) OR (online with no queue and no errors)
  const isButtonDisabled = syncingManually || (!isOnline && !isPending) || (isOnline && !isPending && !isError);

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
          value={isError ? 'Failed' : titleCase(syncStatus)} 
          tone={isError ? 'danger' : 'info'} 
        />
        <StatusCard 
          label="Queue" 
          value={`${pendingQueueCount}`} 
          tone={isPending ? 'warning' : 'success'} 
        />
      </div>

      {/* 4. Explicit Error Feedback Surface */}
      {isError && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', fontSize: '0.875rem' }}>
          <strong>Action Required:</strong> {syncStatus}
        </div>
      )}

      <div style={{ marginTop: '1.5rem' }}>
        <Button onClick={onManualSync} disabled={isButtonDisabled}>
          {syncingManually 
            ? 'Syncing Records...' 
            : isError 
              ? 'Retry Sync' 
              : 'Sync Now'}
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