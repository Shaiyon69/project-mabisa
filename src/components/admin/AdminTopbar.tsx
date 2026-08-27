import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { ThemeToggle } from '../common/ThemeToggle';

type AdminTopbarProps = {
  isOnline: boolean;
  logout: () => Promise<void>;
};

/**
 * There is deliberately no "pending sync" count here. It used to be
 * `useMabisaData().snapshot.pendingQueueCount` — the *admin browser's own*
 * SQLite queue, which on an LGU workstation is always empty and on a shared
 * machine is whatever the last field device left behind. Either way it said
 * nothing about whether the barangay's devices have synced, which is the
 * question the number appeared to answer.
 */
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
