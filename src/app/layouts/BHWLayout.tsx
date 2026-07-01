import { NavLink, Outlet } from 'react-router-dom';
import { useMabisaData } from '../mabisaData';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { PageHeader } from '../../components/common/PageHeader';

const bhwNavItems = [
  { to: '/bhw', label: 'Dashboard', shortLabel: 'Status', end: true },
  { to: '/bhw/register-resident', label: 'Register Resident', shortLabel: 'Resident' },
  { to: '/bhw/health-assessment', label: 'Health Assessment', shortLabel: 'Health' },
  { to: '/bhw/supply-disbursement', label: 'Supply Release', shortLabel: 'Supply' },
];

type BHWLayoutProps = {
  logout: () => Promise<void>;
};

export function BHWLayout({ logout }: BHWLayoutProps) {
  const { isOnline, message } = useMabisaData();

  // BHW screens are intentionally constrained to a phone-sized shell
  // because this interface is packaged as a Capacitor Android application.
  return (
    <main className="bhw-preview-shell">
      <section className="bhw-mobile-shell" aria-label="BHW mobile app preview">
        <PageHeader
          eyebrow="Project MABISA"
          title="BHW Mobile"
          description="Resident profiling, health assessment, supply logging, and offline sync."
          actions={
            <>
              <Badge label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'success' : 'warning'} />
              <Button variant="ghost" onClick={logout}>
                Logout
              </Button>
            </>
          }
        />
        {message ? <p className="notice">{message}</p> : null}

        <div className="bhw-mobile-content">
          <Outlet />
        </div>

        <nav className="bhw-bottom-nav" aria-label="BHW mobile sections">
          {bhwNavItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span className="nav-full">{item.label}</span>
              <span className="nav-short">{item.shortLabel}</span>
            </NavLink>
          ))}
        </nav>
      </section>
    </main>
  );
}
