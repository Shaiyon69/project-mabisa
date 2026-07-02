import { Outlet } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

type AdminLayoutProps = {
  logout: () => Promise<void>;
};

export function AdminLayout({ logout }: AdminLayoutProps) {
  const { isOnline, snapshot } = useMabisaData();

  // Admin screens are desktop-first because barangay officials use the web dashboard from an LGU workstation.
  return (
    <main className="mobile-shell app-layout admin-layout">
      <AdminSidebar />
      <section className="workspace">
        <AdminTopbar isOnline={isOnline} pendingQueueCount={snapshot.pendingQueueCount} logout={logout} />
        <Outlet />
      </section>
    </main>
  );
}
