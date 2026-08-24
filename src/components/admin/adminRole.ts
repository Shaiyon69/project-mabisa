import { useOutletContext } from 'react-router-dom';
import type { UserRole } from '../../types/database';

/**
 * What the portal's pages know about the signed-in account. Only the role, and
 * only because two of the three roles land here: an RHU admin reads every
 * barangay, a barangay administrator also moves its stock. Read through the
 * outlet rather than refetched per page — the session resolved it once at
 * startup, and Row Level Security is what actually decides either way.
 *
 * Its own file because `AdminLayout.tsx` may export components only.
 */
export function useAdminRole(): UserRole | null {
  return useOutletContext<UserRole | null>();
}
