import { AdminAccountMenu } from './AdminAccountMenu';
import { Badge } from '../common/Badge';

type AdminTopbarProps = {
  isOnline: boolean;
  fullName: string | null;
  logout: () => Promise<void>;
};

/**
 * Connectivity and the account, for a window too narrow for the rail. Above
 * 860px this bar is hidden entirely and the foot of `AdminSidebar` carries both;
 * below it the rail is gone, so they have to live here.
 *
 * There is deliberately no "pending sync" count. It used to be
 * `useMabisaData().snapshot.pendingQueueCount` — the *admin browser's own*
 * SQLite queue, which on an LGU workstation is always empty and on a shared
 * machine is whatever the last field device left behind. Either way it said
 * nothing about whether the barangay's devices have synced, which is the
 * question the number appeared to answer.
 */
export function AdminTopbar({ isOnline, fullName, logout }: AdminTopbarProps) {
  return (
    <div className="admin-topbar">
      <Badge label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'success' : 'warning'} />
      <AdminAccountMenu fullName={fullName} logout={logout} />
    </div>
  );
}
