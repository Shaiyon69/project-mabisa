import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../components/admin/AdminLayout';
import { BHWLayout } from '../components/bhw/BHWLayout';
import {
  AccountsPage,
  AdminDashboardPage,
  AnalyticsPage,
  InventoryPage,
  ReportsPage,
  ResidentsPage,
} from '../pages/admin/AdminPages';
import {
  BHWHomePage,
  HealthAssessmentPage,
  ProfilePage,
  RegisterResidentPage,
  ResidentDetailPage,
  // The admin tree exports a ResidentsPage too, and they are different screens:
  // one browses this device's SQLite, the other is the portal's registry.
  ResidentsPage as BhwResidentsPage,
  SupplyDisbursementPage,
} from '../pages/bhw/BHWPages';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { buildsAdmin, buildsBhw, isSingleSurface } from './surface';
import { isPortalRole, type UserRole } from '../types/database';

type AppRoutesProps = {
  logout: () => Promise<void>;
  role: UserRole | null;
  /** False until the profile lookup has settled, so a null role is not yet an answer. */
  roleChecked: boolean;
  /** The signed-in account's name, from the same cached profile row as the role. */
  fullName: string | null;
};

export function AppRoutes({ logout, role, roleChecked, fullName }: AppRoutesProps) {
  // Both surfaces are gated on one predicate rather than one test per role: an
  // unknown role has to land somewhere, and giving each surface its own would
  // leave a null role rejected by both and bouncing between them forever.
  //
  // Two of the three roles in public.app_role belong here. `admin` is the RHU or
  // LGU account that reads every barangay; `barangay_admin` runs one barangay and
  // is the only role the stock-allocation RPCs accept. They share the portal and
  // differ in what each screen offers, which is settled per screen from `role`
  // rather than by a second route tree.
  const isAdmin = isPortalRole(role);
  const belongsHere = isAdmin ? buildsAdmin : buildsBhw;

  // What a non-admin sees when it reaches the admin portal, in either build. The
  // portal is not somewhere a BHW account can be redirected out of: on the admin
  // deployment the field app is a different machine entirely, and in a combined
  // build a silent bounce to /bhw means someone who signed in at the portal ends
  // up in the phone app with no explanation. Say so instead.
  //
  // Held until `roleChecked`, because a session resolves to no role while the
  // profile lookup is in flight — the same value a genuinely role-less account
  // has. Rendering the rejection early would greet every admin with it.
  const adminRejection = roleChecked ? (
    <SurfaceNotice
      title="This is the BRHP-MSAM admin portal"
      body="This account signs in through the BRHP-MSAM app on a Barangay Health Worker's phone. Nothing is wrong with your account — this is the wrong place for it."
      logout={logout}
    />
  ) : (
    <SurfaceNotice title="Checking your account" body="One moment." />
  );

  // A single-surface BHW build has nowhere to send an admin: the portal is another
  // deployment, not another path here.
  if (isSingleSurface && !belongsHere) {
    return buildsAdmin ? (
      adminRejection
    ) : !roleChecked ? (
      <SurfaceNotice title="Checking your account" body="One moment." />
    ) : (
      <SurfaceNotice
        title="This is the BRHP-MSAM field app"
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
        <Route path="/bhw" element={isAdmin && buildsAdmin ? <Navigate to="/admin" replace /> : <BHWLayout logout={logout} fullName={fullName} />}>
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
        <Route path="/admin" element={isAdmin ? <AdminLayout logout={logout} fullName={fullName} role={role} /> : adminRejection}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="residents" element={<ResidentsPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="reports" element={<ReportsPage />} />
        </Route>
      ) : null}

      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

/** The whole screen when a session has reached the wrong deployment. */
function SurfaceNotice({ title, body, logout }: { title: string; body: string; logout?: () => Promise<void> }) {
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
