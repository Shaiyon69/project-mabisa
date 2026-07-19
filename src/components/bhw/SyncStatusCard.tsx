import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { titleCase } from '../../lib/utils';
import { useBhwLanguage } from '../../app/BhwLanguageContext';

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
  const { t } = useBhwLanguage();
  
  const isError = syncStatus.toLowerCase().includes('error') || syncStatus.toLowerCase().includes('fail');
  const isPending = pendingQueueCount > 0;

  const syncedLabel = t(isError ? 'Sync Failed' : isPending ? 'Pending Sync' : 'Synced');
  const badgeTone = isError ? 'danger' : (!isOnline || isPending) ? 'warning' : 'success';

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
          value={isError ? 'Failed' : titleCase(syncStatus)} 
          tone={isError ? 'danger' : 'info'} 
        />
        <StatusCard 
          label={t('Queue')}
          value={`${pendingQueueCount}`} 
          tone={isPending ? 'warning' : 'success'} 
        />
      </div>

      {isError && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', fontSize: '0.875rem' }}>
          <strong>{t('Action Required:')}</strong> {syncStatus}
        </div>
      )}

      <div style={{ marginTop: '1.5rem' }}>
        <Button onClick={onManualSync} disabled={isButtonDisabled}>
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
