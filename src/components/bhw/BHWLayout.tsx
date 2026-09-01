import { NavLink, Outlet } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import { PinGate } from './PinGate';
import type { SyncStatus } from '../../services/syncService';
import { PageHeader } from '../common/PageHeader';
import { Icon } from '../common/Icon';

const bhwNavItems = [
  { to: '/bhw', label: 'Dashboard', shortLabel: 'Status', icon: 'home' as const, end: true },
  { to: '/bhw/register-resident', label: 'Register Resident', shortLabel: 'Resident', icon: 'user' as const },
  { to: '/bhw/health-assessment', label: 'Health Assessment', shortLabel: 'Health', icon: 'heart' as const },
  { to: '/bhw/supply-disbursement', label: 'Supply Release', shortLabel: 'Supply', icon: 'package' as const },
  { to: '/bhw/profile', label: 'Profile', shortLabel: 'Profile', icon: 'profile' as const },
];

type BHWLayoutProps = {
  logout: () => Promise<void>;
};

/** Logout is handed to the profile screen through the outlet rather than a prop
    chain, because it is the only route that uses it. */
export type BhwOutletContext = {
  logout: () => Promise<void>;
};

// Record safety is a rail on every screen, not a badge on one — a BHW shouldn't
// have to open a screen to check whether the last hour of encoding is still only on this phone.
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
  const { bhwId, isOnline, message, syncStatus, snapshot } = useMabisaData();
  const rail = recordRail(isOnline, syncStatus, snapshot.pendingQueueCount, snapshot.deadLetterEntries.length);
  const { update, dismiss } = useAppUpdate();

  // BHW uses a phone-sized shell because this interface is packaged with Capacitor.
  return (
    <main className="bhw-preview-shell">
      <section className="bhw-mobile-shell" aria-label="BHW mobile app preview">
        {/* Records stay saved and queued underneath the gate — the count is shown there so nobody reads it as lost work. */}
        <PinGate userId={bhwId} pendingRecordCount={snapshot.pendingQueueCount}>
        <p className={`field-rail field-rail-${rail.tone}`} role="status">
          {rail.label}
        </p>

        {/* A sideloaded app has no store to nag on its behalf, so the app says it itself.
            ponytail: the link hands the APK to the system browser, which downloads it and
            lets Android's installer take over — no in-app progress and no
            REQUEST_INSTALL_PACKAGES permission. Swap for a Filesystem download plus a file
            opener plugin if health workers lose the thread between the two. */}
        {update ? (
          <p className="field-rail field-rail-hold app-update-rail" role="status">
            <span>Update {update.version} is ready</span>
            <a href={update.url} target="_blank" rel="noreferrer">
              Install
            </a>
            <button type="button" onClick={dismiss}>
              Later
            </button>
          </p>
        ) : null}

        {/* No header actions — connection state lives on the rail; theme/logout live on the Profile tab. */}
        <PageHeader eyebrow="Project MABISA" title="BHW Mobile" />
        {message ? <p className="notice">{message}</p> : null}

        <div className="bhw-mobile-content">
          <Outlet context={{ logout } satisfies BhwOutletContext} />
        </div>

        <nav className="bhw-bottom-nav" aria-label="BHW mobile sections">
          {bhwNavItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} size={19} />
              <span className="nav-full">{item.label}</span>
              <span className="nav-short">{item.shortLabel}</span>
            </NavLink>
          ))}
        </nav>
        </PinGate>
      </section>
    </main>
  );
}
