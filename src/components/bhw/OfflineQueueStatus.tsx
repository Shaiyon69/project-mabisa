import { Badge } from '../common/Badge';

type OfflineQueueStatusProps = {
  pendingQueueCount: number;
};

export function OfflineQueueStatus({ pendingQueueCount }: OfflineQueueStatusProps) {
  return <Badge label={pendingQueueCount ? 'Pending Sync' : 'Saved Offline'} tone={pendingQueueCount ? 'warning' : 'success'} />;
}
