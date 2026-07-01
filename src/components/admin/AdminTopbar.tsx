import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

type AdminTopbarProps = {
  isOnline: boolean;
  pendingQueueCount: number;
  logout: () => Promise<void>;
};

export function AdminTopbar({ isOnline, pendingQueueCount, logout }: AdminTopbarProps) {
  return (
    <div className="admin-topbar">
      <div>
        <strong>Barangay Official Workspace</strong>
        <span>Local monitoring dashboard</span>
      </div>
      <div className="header-actions">
        <Badge label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'success' : 'warning'} />
        <Badge label={`${pendingQueueCount} Pending`} tone={pendingQueueCount ? 'warning' : 'success'} />
        <Button variant="ghost" onClick={logout}>
          Logout
        </Button>
      </div>
    </div>
  );
}
