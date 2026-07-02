import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../../components/admin/AdminLayout';
import { BHWLayout } from '../../components/bhw/BHWLayout';
import { AccountsPage, AdminDashboardPage, InventoryPage, ReportsPage, ResidentsPage } from '../../pages/admin/AdminPages';
import { BHWHomePage, HealthAssessmentPage, RegisterResidentPage, SupplyDisbursementPage } from '../../pages/bhw/BHWPages';

type AppRoutesProps = {
  logout: () => Promise<void>;
};

export function AppRoutes({ logout }: AppRoutesProps) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/bhw" replace />} />
      <Route path="/bhw" element={<BHWLayout logout={logout} />}>
        <Route index element={<BHWHomePage />} />
        <Route path="register-resident" element={<RegisterResidentPage />} />
        <Route path="health-assessment" element={<HealthAssessmentPage />} />
        <Route path="supply-disbursement" element={<SupplyDisbursementPage />} />
      </Route>
      <Route path="/admin" element={<AdminLayout logout={logout} />}>
        <Route index element={<AdminDashboardPage />} />
        <Route path="residents" element={<ResidentsPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/bhw" replace />} />
    </Routes>
  );
}
