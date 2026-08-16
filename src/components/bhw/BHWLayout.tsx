import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import type { SyncStatus } from '../../services/syncService';
import { Button } from '../common/Button';
import { PageHeader } from '../common/PageHeader';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import { BhwLanguageProvider, useBhwLanguage } from '../../app/BhwLanguageContext';

const bhwNavItems = [
  { to: '/bhw', label: 'Dashboard', shortLabel: 'Status', icon: 'home' as const, end: true },
  { to: '/bhw/register-resident', label: 'Register Resident', shortLabel: 'Resident', icon: 'user' as const },
  { to: '/bhw/health-assessment', label: 'Health Assessment', shortLabel: 'Health', icon: 'heart' as const },
  { to: '/bhw/supply-disbursement', label: 'Supply Release', shortLabel: 'Supply', icon: 'package' as const },
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
  return (
    <BhwLanguageProvider>
      <BHWLayoutContent logout={logout} />
    </BhwLanguageProvider>
  );
}

function BHWLayoutContent({ logout }: BHWLayoutProps) {
  const { isOnline, message, syncStatus, snapshot } = useMabisaData();
  const { language, setLanguage, t } = useBhwLanguage();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const rail = recordRail(isOnline, syncStatus, snapshot.pendingQueueCount, snapshot.deadLetterEntries.length);

  async function handleLogout() {
    setConfirmingLogout(false);
    await logout();
  }

  // BHW uses a phone-sized shell because this interface is packaged with Capacitor.
  return (
    <main className="bhw-preview-shell">
      <section className="bhw-mobile-shell" aria-label="BHW mobile app preview">
        <p className={`field-rail field-rail-${rail.tone}`} role="status">
          {rail.label}
        </p>

        <PageHeader
          eyebrow={t('Project MABISA')}
          title={t('BHW Mobile')}
          actions={
            // Connection state lives on the rail above, so it is not repeated here.
            <>
              <div className="language-toggle" role="group" aria-label="English or Filipino language">
                <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>
                  EN
                </button>
                <button type="button" className={language === 'fil' ? 'active' : ''} onClick={() => setLanguage('fil')}>
                  FIL
                </button>
              </div>
              <Button variant="danger" className="logout-button" onClick={() => setConfirmingLogout(true)}>
                <Icon name="logout" size={17} />
                {t('Logout')}
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
              <Icon name={item.icon} size={19} />
              <span className="nav-full">{item.label}</span>
              <span className="nav-short">{t(item.shortLabel)}</span>
            </NavLink>
          ))}
        </nav>
        <Modal open={confirmingLogout} title={t('Log out of MABISA?')} onClose={() => setConfirmingLogout(false)}>
          <p className="logout-warning"><Icon name="warning" size={20} />{t('Make sure pending records are synchronized before leaving this device.')}</p>
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setConfirmingLogout(false)}>{t('Stay logged in')}</Button>
            <Button variant="danger" onClick={() => void handleLogout()}><Icon name="logout" size={17} />{t('Log out')}</Button>
          </div>
        </Modal>
      </section>
    </main>
  );
}
