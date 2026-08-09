import { NavLink, Outlet } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import type { SyncStatus } from '../../services/syncService';
import { Button } from '../common/Button';
import { PageHeader } from '../common/PageHeader';

const bhwNavItems = [
  { to: '/bhw', label: 'Dashboard', shortLabel: 'Status', end: true },
  { to: '/bhw/register-resident', label: 'Register Resident', shortLabel: 'Resident' },
  { to: '/bhw/health-assessment', label: 'Health Assessment', shortLabel: 'Health' },
  { to: '/bhw/supply-disbursement', label: 'Supply Release', shortLabel: 'Supply' },
];

type BHWLayoutProps = {
  logout: () => Promise<void>;
};

// A BHW should never have to open a screen to learn whether the last hour of
// encoding is still only on this phone, so record safety rides on a rail that
// is present on every screen rather than a badge on one of them.
function recordRail(
  isOnline: boolean,
  syncStatus: SyncStatus,
  pendingQueueCount: number,
  setAsideCount: number,
): { tone: 'clear' | 'hold' | 'alert'; label: string } {
  const records = (count: number) => `${count} record${count === 1 ? '' : 's'}`;

  if (setAsideCount > 0) {
    return { tone: 'alert', label: `${records(setAsideCount)} need review` };
  }

  if (syncStatus === 'failed') {
    return { tone: 'alert', label: 'Sync failed — open Status' };
  }

  if (!isOnline) {
    return {
      tone: 'hold',
      label: pendingQueueCount ? `Offline — ${records(pendingQueueCount)} held here` : 'Offline — records save here',
    };
  }

  if (pendingQueueCount > 0) {
    return { tone: 'hold', label: `${records(pendingQueueCount)} waiting to send` };
  }

  return { tone: 'clear', label: 'All records sent' };
}

export function BHWLayout({ logout }: BHWLayoutProps) {
  const { isOnline, message, syncStatus, snapshot } = useMabisaData();
  const rail = recordRail(isOnline, syncStatus, snapshot.pendingQueueCount, snapshot.deadLetterEntries.length);

  // BHW uses a phone-sized shell because this interface is packaged with Capacitor.
  return (
    <main className="bhw-preview-shell">
      <section className="bhw-mobile-shell" aria-label="BHW mobile app preview">
        <p className={`field-rail field-rail-${rail.tone}`} role="status">
          {rail.label}
        </p>

        <PageHeader
          eyebrow="Project MABISA"
          title="BHW Mobile"
          actions={
            // Connection state lives on the rail above, so it is not repeated here.
            <Button variant="ghost" onClick={logout}>
              Logout
            </Button>
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
