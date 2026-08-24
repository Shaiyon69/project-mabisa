import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { ThemeToggle } from '../common/ThemeToggle';

type AdminTopbarProps = {
  isOnline: boolean;
  logout: () => Promise<void>;
};

export function AdminTopbar({ isOnline, logout }: AdminTopbarProps) {
  return (
    <div className="admin-topbar">
      <div>
        <strong>Barangay Official Workspace</strong>
        <span>Local monitoring dashboard</span>
      </div>
      <div className="header-actions">
        <Badge label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'success' : 'warning'} />
        <ThemeToggle />
        <Button variant="ghost" onClick={logout}>
          Logout
        </Button>
      </div>
    </div>
  );
}
