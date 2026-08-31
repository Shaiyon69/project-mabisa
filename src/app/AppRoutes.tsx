import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../components/admin/AdminLayout';
import { BHWLayout } from '../components/bhw/BHWLayout';
import { AccountsPage, AdminDashboardPage, InventoryPage, ReportsPage, ResidentsPage } from '../pages/admin/AdminPages';
import {
  BHWHomePage,
  HealthAssessmentPage,
  ProfilePage,
  RegisterResidentPage,
  ResidentDetailPage,
  // The admin tree exports a ResidentsPage too — different screen, this device's SQLite vs. the portal's registry.
  ResidentsPage as BhwResidentsPage,
  SupplyDisbursementPage,
} from '../pages/bhw/BHWPages';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { buildsAdmin, buildsBhw, isSingleSurface } from './surface';
import { isDeskRole, type UserRole } from '../types/database';

type AppRoutesProps = {
  logout: () => Promise<void>;
  role: UserRole | null;
  /** False until the profile lookup has settled, so a null role is not yet an answer. */
  roleChecked: boolean;
};

export function AppRoutes({ logout, role, roleChecked }: AppRoutesProps) {
  // One flag for both surfaces — a per-role predicate would leave a null (not-yet-known)
  // role rejected by both and bouncing between them. The portal itself doesn't branch
  // on admin vs. barangay_admin; RLS draws that line, not this flag.
  const isAdmin = isDeskRole(role);
  const belongsHere = isAdmin ? buildsAdmin : buildsBhw;

  // What a non-admin sees at the admin portal — never a silent bounce to /bhw,
  // since on the admin deployment the field app is a different machine entirely.
  // Held until roleChecked, since an in-flight lookup and a genuinely role-less
  // account both resolve to null.
  const adminRejection = roleChecked ? (
    <SurfaceNotice
      title="This is the MABISA admin portal"
      body="This account signs in through the MABISA app on a Barangay Health Worker's phone. Nothing is wrong with your account — this is the wrong place for it."
      logout={logout}
    />
  ) : (
    <SurfaceNotice title="Checking your account" body="One moment." />
  );

  // A single-surface BHW build has nowhere to send an admin — the portal is another deployment, not another path here.
  if (isSingleSurface && !belongsHere) {
    return buildsAdmin ? (
      adminRejection
    ) : !roleChecked ? (
      <SurfaceNotice title="Checking your account" body="One moment." />
    ) : (
      <SurfaceNotice
        title="This is the MABISA field app"
        body="Administrator accounts sign in to the admin portal in a web browser, not on this phone."
        logout={logout}
      />
    );
  }

  const home = isAdmin && buildsAdmin ? '/admin' : '/bhw';

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />

      {buildsBhw ? (
        <Route path="/bhw" element={isAdmin && buildsAdmin ? <Navigate to="/admin" replace /> : <BHWLayout logout={logout} />}>
          <Route index element={<BHWHomePage />} />
          <Route path="register-resident" element={<RegisterResidentPage />} />
          <Route path="residents" element={<BhwResidentsPage />} />
          <Route path="residents/:residentId" element={<ResidentDetailPage />} />
          <Route path="health-assessment" element={<HealthAssessmentPage />} />
          <Route path="supply-disbursement" element={<SupplyDisbursementPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      ) : null}

      {buildsAdmin ? (
        <Route
          path="/admin"
          element={
            isAdmin ? (
              <AdminLayout logout={logout} role={role} />
            ) : roleChecked && buildsBhw ? (
              // A health worker who lands here has their own screens to go to, so
              // send them rather than explain. The notice below is for the build
              // that has no field app to send anyone to.
              <Navigate to="/bhw" replace />
            ) : (
              adminRejection
            )
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="residents" element={<ResidentsPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="reports" element={<ReportsPage />} />
        </Route>
      ) : null}

      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

/** The whole screen when a session cannot be let through — the wrong deployment, or a device that is not free. */
export function SurfaceNotice({ title, body, logout }: { title: string; body: string; logout?: () => Promise<void> }) {
  return (
    <main className="mobile-shell auth-shell">
      <Card className="login-panel">
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        {logout ? (
          <Button variant="secondary" onClick={() => void logout()}>
            Sign out
          </Button>
        ) : null}
      </Card>
    </main>
  );
}
