import { useOutletContext } from 'react-router-dom';
import type { UserRole } from '../../types/database';

/**
 * The signed-in account's role, for the two that reach the portal: an RHU admin
 * reads every barangay, a barangay administrator also moves its stock. Read
 * through the outlet rather than refetched per page.
 *
 * Its own file because `AdminLayout.tsx` may export components only.
 */
export function useAdminRole(): UserRole | null {
  return useOutletContext<UserRole | null>();
}
