import { Outlet } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import type { UserRole } from '../../types/database';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

type AdminLayoutProps = {
  logout: () => Promise<void>;
  role: UserRole | null;
};

export function AdminLayout({ logout, role }: AdminLayoutProps) {
  const { isOnline, snapshot } = useMabisaData();

  // Admin screens are desktop-first because barangay officials use the web dashboard from an LGU workstation.
  return (
    <main className="mobile-shell app-layout admin-layout">
      <AdminSidebar />
      <section className="workspace">
        <AdminTopbar isOnline={isOnline} pendingQueueCount={snapshot.pendingQueueCount} logout={logout} />
        <Outlet context={role} />
      </section>
    </main>
  );
}
