import { Outlet } from 'react-router-dom';
import { useMabisaData } from '../mabisaData';
import { AdminSidebar } from '../../components/admin/AdminSidebar';
import { AdminTopbar } from '../../components/admin/AdminTopbar';

type AdminLayoutProps = {
  logout: () => Promise<void>;
};

export function AdminLayout({ logout }: AdminLayoutProps) {
  const { isOnline, snapshot } = useMabisaData();

  // Admin screens are desktop-first because barangay officials use the web dashboard
  // from a browser-based LGU workstation.
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
