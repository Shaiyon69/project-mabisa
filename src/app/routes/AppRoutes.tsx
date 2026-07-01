import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../layouts/AdminLayout';
import { BHWLayout } from '../layouts/BHWLayout';
import { AccountsPage } from '../../pages/admin/AccountsPage';
import { AdminDashboardPage } from '../../pages/admin/AdminDashboardPage';
import { InventoryPage } from '../../pages/admin/InventoryPage';
import { ReportsPage } from '../../pages/admin/ReportsPage';
import { ResidentsPage } from '../../pages/admin/ResidentsPage';
import { BHWHomePage } from '../../pages/bhw/BHWHomePage';
import { HealthAssessmentPage } from '../../pages/bhw/HealthAssessmentPage';
import { RegisterResidentPage } from '../../pages/bhw/RegisterResidentPage';
import { SupplyDisbursementPage } from '../../pages/bhw/SupplyDisbursementPage';

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
