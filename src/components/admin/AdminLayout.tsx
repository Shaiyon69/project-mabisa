import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AdminSidebar, AdminTabs } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';
import type { UserRole } from '../../types/database';

type AdminLayoutProps = {
  logout: () => Promise<void>;
  /** The signed-in account's name, from the cached profile row read at sign-in. */
  fullName: string | null;
  /** `admin` or `barangay_admin` — both live here and each screen offers a different subset. */
  role: UserRole | null;
};

/**
 * Connectivity for the portal, read from `navigator.onLine` rather than
 * `useMabisaData()`, whose flag rides along with the BHW sync engine the portal
 * never mounts. Every admin screen reads Supabase live, so offline means the
 * next read fails.
 */
function useBrowserOnline(): boolean {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);

    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return isOnline;
}

export function AdminLayout({ logout, fullName, role }: AdminLayoutProps) {
  const isOnline = useBrowserOnline();

  // Admin screens are desktop-first because barangay officials use the web dashboard from an LGU workstation.
  return (
    <main className="mobile-shell app-layout admin-layout">
      <AdminSidebar fullName={fullName} role={role} logout={logout} />
      <section className="workspace">
        {/* Narrow windows only — above 860px the rail carries the account and the
            navigation and this whole block is hidden. Topbar and tabs stick as
            one block: they are what must stay reachable from the middle of a
            long table, and pinning them separately would mean guessing the
            topbar's height in the tab bar's `top`. */}
        <div className="admin-header">
          <AdminTopbar isOnline={isOnline} fullName={fullName} role={role} logout={logout} />
          <AdminTabs />
        </div>
        {/* The role reaches the pages through the outlet rather than a provider:
            it is one value, it never changes inside a session, and a context for
            it would be a second place the same profile row is remembered. Pages
            read it through `useAdminRole()`, which lives in its own file because
            this one may export components only. */}
        <Outlet context={role} />
      </section>
    </main>
  );
}
