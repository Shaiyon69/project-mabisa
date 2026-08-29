import { NavLink, Outlet } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import type { SyncStatus } from '../../services/syncService';
import { PageHeader } from '../common/PageHeader';
import { Icon } from '../common/Icon';
import { BhwLanguageProvider } from '../../app/BhwLanguageContext';
import { useBhwLanguage } from '../../app/bhwLanguage';

const bhwNavItems = [
  { to: '/bhw', label: 'Dashboard', shortLabel: 'Status', icon: 'home' as const, end: true },
  { to: '/bhw/register-resident', label: 'Register Resident', shortLabel: 'Resident', icon: 'user' as const },
  { to: '/bhw/health-assessment', label: 'Health Assessment', shortLabel: 'Health', icon: 'heart' as const },
  { to: '/bhw/supply-disbursement', label: 'Supply Release', shortLabel: 'Supply', icon: 'package' as const },
  { to: '/bhw/profile', label: 'Profile', shortLabel: 'Profile', icon: 'profile' as const },
];

type BHWLayoutProps = {
  logout: () => Promise<void>;
  fullName: string | null;
};

/** Logout and the account name are handed to the profile screen through the
    outlet rather than a prop chain, because it is the only route that uses
    either. The name is threaded down from App rather than fetched here: it comes
    from the cached profile row read at sign-in, so it is on screen on a phone
    that has not reached the network in a week. */
export type BhwOutletContext = {
  logout: () => Promise<void>;
  fullName: string | null;
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

export function BHWLayout({ logout, fullName }: BHWLayoutProps) {
  return (
    <BhwLanguageProvider>
      <BHWLayoutContent logout={logout} fullName={fullName} />
    </BhwLanguageProvider>
  );
}

function BHWLayoutContent({ logout, fullName }: BHWLayoutProps) {
  const { isOnline, message, syncStatus, snapshot } = useMabisaData();
  const { t } = useBhwLanguage();
  const rail = recordRail(isOnline, syncStatus, snapshot.pendingQueueCount, snapshot.deadLetterEntries.length);

  // BHW uses a phone-sized shell because this interface is packaged with Capacitor.
  return (
    <main className="bhw-preview-shell">
      <section className="bhw-mobile-shell" aria-label="BHW mobile app preview">
        <p className={`field-rail field-rail-${rail.tone}`} role="status">
          {rail.label}
        </p>

        {/* No header actions: connection state lives on the rail above, and theme
            and logout now live on the Profile tab so the top of every screen is
            content rather than controls. */}
        <PageHeader eyebrow={t('BRHP-MSAM')} title={t('BHW Mobile')} />
        {message ? <p className="notice">{message}</p> : null}

        <div className="bhw-mobile-content">
          <Outlet context={{ logout, fullName } satisfies BhwOutletContext} />
        </div>

        <nav className="bhw-bottom-nav" aria-label="BHW mobile sections">
          {bhwNavItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} size={19} />
              <span className="nav-full">{item.label}</span>
              <span className="nav-short">{t(item.shortLabel)}</span>
            </NavLink>
          ))}
        </nav>
      </section>
    </main>
  );
}
