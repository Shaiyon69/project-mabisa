import { AdminAccountMenu } from './AdminAccountMenu';
import { Badge } from '../common/Badge';

type AdminTopbarProps = {
  isOnline: boolean;
  fullName: string | null;
  logout: () => Promise<void>;
};

/**
 * Connectivity and the account, for a window too narrow for the rail. Hidden above
 * 860px, where the foot of `AdminSidebar` carries both.
 *
 * No pending-sync count: the only queue this browser can see is its own, which
 * says nothing about whether the barangay's devices have synced.
 */
export function AdminTopbar({ isOnline, fullName, logout }: AdminTopbarProps) {
  return (
    <div className="admin-topbar">
      <Badge label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'success' : 'warning'} />
      <AdminAccountMenu fullName={fullName} logout={logout} />
    </div>
  );
}
