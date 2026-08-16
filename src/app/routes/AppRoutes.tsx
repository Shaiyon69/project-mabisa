import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../../components/admin/AdminLayout';
import { BHWLayout } from '../../components/bhw/BHWLayout';
import { AccountsPage, AdminDashboardPage, InventoryPage, ReportsPage, ResidentsPage } from '../../pages/admin/AdminPages';
import { BHWHomePage, HealthAssessmentPage, RegisterResidentPage, SupplyDisbursementPage } from '../../pages/bhw/BHWPages';
import type { UserRole } from '../../types/database';

type AppRoutesProps = {
  logout: () => Promise<void>;
  role: UserRole | null;
};

export function AppRoutes({ logout, role }: AppRoutesProps) {
  // Both surfaces are gated, and on the same flag rather than one test per role: an
  // unknown role has to land somewhere, and giving each surface its own predicate
  // would leave a null role rejected by both and bouncing between them forever.
  const isAdmin = role === 'admin' || role === 'lgu';
  const home = isAdmin ? '/admin' : '/bhw';

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/bhw" element={isAdmin ? <Navigate to="/admin" replace /> : <BHWLayout logout={logout} />}>
        <Route index element={<BHWHomePage />} />
        <Route path="register-resident" element={<RegisterResidentPage />} />
        <Route path="health-assessment" element={<HealthAssessmentPage />} />
        <Route path="supply-disbursement" element={<SupplyDisbursementPage />} />
      </Route>
      <Route path="/admin" element={isAdmin ? <AdminLayout logout={logout} /> : <Navigate to="/bhw" replace />}>
        <Route index element={<AdminDashboardPage />} />
        <Route path="residents" element={<ResidentsPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
