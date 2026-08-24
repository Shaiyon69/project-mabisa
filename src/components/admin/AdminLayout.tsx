import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { UserRole } from '../../types/database';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

type AdminLayoutProps = {
  logout: () => Promise<void>;
  role: UserRole | null;
};

/**
 * The browser's own connectivity, not the BHW sync engine's. The admin portal
 * has no offline mode and no local queue (see adminData.ts) — this is only
 * "can this workstation currently reach Supabase" for the topbar badge.
 */
function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

export function AdminLayout({ logout, role }: AdminLayoutProps) {
  const isOnline = useOnlineStatus();

  // Admin screens are desktop-first because barangay officials use the web dashboard from an LGU workstation.
  return (
    <main className="mobile-shell app-layout admin-layout">
      <AdminSidebar />
      <section className="workspace">
        <AdminTopbar isOnline={isOnline} logout={logout} />
        <Outlet context={role} />
      </section>
    </main>
  );
}
