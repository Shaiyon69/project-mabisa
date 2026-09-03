import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { buildsAdmin, buildsBhw, isSingleSurface } from './surface';
import { isDeskRole, type UserRole } from '../types/database';

// Every screen behind a `lazy()`, so the two surfaces land in two chunks rather
// than one. The `buildsAdmin`/`buildsBhw` guards below fold to a literal at build
// time and were supposed to let the bundler shake the other surface out on their
// own — they don't: the field build's entry chunk still carried the portal's
// registry, charts and barangay map, which is a third of a bundle a phone can
// never render. An import the bundler has to split anyway cannot be got wrong
// that way.
//
// Both trees are barrel modules, so this is two chunks and not fifteen. That is
// the split that matters here: what a build must not carry is the *other*
// surface, and within one surface the screens share almost all of their imports.
const AdminLayout = lazy(() => import('../components/admin/AdminLayout').then((module) => ({ default: module.AdminLayout })));
const AdminDashboardPage = lazy(() => import('../pages/admin/AdminPages').then((module) => ({ default: module.AdminDashboardPage })));
const ResidentsPage = lazy(() => import('../pages/admin/AdminPages').then((module) => ({ default: module.ResidentsPage })));
const InventoryPage = lazy(() => import('../pages/admin/AdminPages').then((module) => ({ default: module.InventoryPage })));
const AccountsPage = lazy(() => import('../pages/admin/AdminPages').then((module) => ({ default: module.AccountsPage })));
const AnalyticsPage = lazy(() => import('../pages/admin/AdminPages').then((module) => ({ default: module.AnalyticsPage })));
const ReportsPage = lazy(() => import('../pages/admin/AdminPages').then((module) => ({ default: module.ReportsPage })));

const BHWLayout = lazy(() => import('../components/bhw/BHWLayout').then((module) => ({ default: module.BHWLayout })));
const BHWHomePage = lazy(() => import('../pages/bhw/BHWPages').then((module) => ({ default: module.BHWHomePage })));
const RegisterResidentPage = lazy(() => import('../pages/bhw/BHWPages').then((module) => ({ default: module.RegisterResidentPage })));
// The admin tree exports a ResidentsPage too — different screen, this device's SQLite vs. the portal's registry.
const BhwResidentsPage = lazy(() => import('../pages/bhw/BHWPages').then((module) => ({ default: module.ResidentsPage })));
const ResidentDetailPage = lazy(() => import('../pages/bhw/BHWPages').then((module) => ({ default: module.ResidentDetailPage })));
const HealthAssessmentPage = lazy(() => import('../pages/bhw/BHWPages').then((module) => ({ default: module.HealthAssessmentPage })));
const SupplyDisbursementPage = lazy(() => import('../pages/bhw/BHWPages').then((module) => ({ default: module.SupplyDisbursementPage })));
const ProfilePage = lazy(() => import('../pages/bhw/BHWPages').then((module) => ({ default: module.ProfilePage })));

type AppRoutesProps = {
  logout: () => Promise<void>;
  role: UserRole | null;
  /** False until the profile lookup has settled, so a null role is not yet an answer. */
  roleChecked: boolean;
  /** The signed-in account's name, cached alongside the role so it survives an offline start. */
  fullName: string | null;
};

export function AppRoutes({ logout, role, roleChecked, fullName }: AppRoutesProps) {
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
      title="This is the BRHP-MSAM admin portal"
      body="This account signs in through the BRHP-MSAM app on a Barangay Health Worker's phone. Nothing is wrong with your account — this is the wrong place for it."
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
        title="This is the BRHP-MSAM field app"
        body="Administrator accounts sign in to the admin portal in a web browser, not on this phone."
        logout={logout}
      />
    );
  }

  const home = isAdmin && buildsAdmin ? '/admin' : '/bhw';

  return (
    // On the phone the chunk is already on the filesystem, so this fallback is a
    // frame rather than a wait — the same trade `App.tsx` makes for the offline
    // engine. On the portal it is one request against a wired workstation.
    <Suspense fallback={<SurfaceNotice title="Loading" body="One moment." />}>
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
          <Route
            path="/admin"
            element={
              isAdmin ? (
                <AdminLayout logout={logout} role={role} fullName={fullName} />
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
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>
        ) : null}

        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Suspense>
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
