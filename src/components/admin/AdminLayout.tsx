import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

type AdminLayoutProps = {
  logout: () => Promise<void>;
};

/**
 * Connectivity for the portal, read from the browser rather than from
 * `useMabisaData()`.
 *
 * The provider's flag comes from `@capacitor/network` and rides along with the
 * BHW sync engine, which the portal does not mount: an LGU workstation has no
 * local SQLite mirror and no queue to drain. `navigator.onLine` is the same
 * answer without any of that, and it is the one that matters here — every admin
 * screen reads Supabase live, so offline means the next read fails.
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

export function AdminLayout({ logout }: AdminLayoutProps) {
  const isOnline = useBrowserOnline();

  // Admin screens are desktop-first because barangay officials use the web dashboard from an LGU workstation.
  return (
    <main className="mobile-shell app-layout admin-layout">
      <AdminSidebar />
      <section className="workspace">
        <AdminTopbar isOnline={isOnline} logout={logout} />
        <Outlet />
      </section>
    </main>
  );
}
