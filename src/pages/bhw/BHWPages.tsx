import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import { useBhwLanguage } from '../../app/BhwLanguageContext';
import { BHWDashboard } from '../../components/bhw/BHWDashboard';
import { HealthAssessmentForm } from '../../components/bhw/HealthAssessmentForm';
import { HouseholdForm } from '../../components/bhw/HouseholdForm';
import { SupplyDisbursementForm } from '../../components/bhw/SupplyDisbursementForm';
import type { BhwOutletContext } from '../../components/bhw/BHWLayout';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { Icon } from '../../components/common/Icon';
import { Modal } from '../../components/common/Modal';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { supabase } from '../../lib/supabase';

export function BHWHomePage() {
  const { snapshot, isOnline, syncStatus, syncError, lastSyncAt, syncingManually, runManualSync, retryDeadLetters } =
    useMabisaData();

  return (
    <BHWDashboard
      snapshot={snapshot}
      isOnline={isOnline}
      syncStatus={syncStatus}
      syncError={syncError}
      lastSyncAt={lastSyncAt}
      syncingManually={syncingManually}
      onManualSync={runManualSync}
      onRetryDeadLetters={retryDeadLetters}
    />
  );
}

export function RegisterResidentPage() {
  const navigate = useNavigate();
  const { bhwId, refreshLocalData, setMessage } = useMabisaData();

  return (
    <HouseholdForm
      bhwId={bhwId}
      onSaved={async () => {
        await refreshLocalData();
        setMessage('Saved Offline. Household profile is queued for sync.');
        navigate('/bhw');
      }}
    />
  );
}

export function HealthAssessmentPage() {
  const navigate = useNavigate();
  const { snapshot, refreshLocalData, setMessage } = useMabisaData();

  return (
    <HealthAssessmentForm
      individualCount={snapshot.individualCount}
      onSaved={async () => {
        await refreshLocalData();
        setMessage('Pending Sync. Health assessment was saved on this device.');
        navigate('/bhw');
      }}
    />
  );
}

export function ProfilePage() {
  const { logout } = useOutletContext<BhwOutletContext>();
  const { t } = useBhwLanguage();
  const { snapshot } = useMabisaData();
  const [email, setEmail] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  // getSession reads the cached session, so the account line still renders on a
  // phone that has been offline all day; getUser would go to the network.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  return (
    <Card>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{t('Account')}</p>
          <h2>{t('Profile')}</h2>
        </div>
      </div>

      <dl className="profile-facts">
        <div>
          <dt>{t('Signed in as')}</dt>
          <dd>{email ?? '—'}</dd>
        </div>
        <div>
          <dt>{t('Role')}</dt>
          <dd>{t('Barangay Health Worker')}</dd>
        </div>
        <div>
          <dt>{t('Records on this device')}</dt>
          <dd>{snapshot.householdCount + snapshot.individualCount}</dd>
        </div>
      </dl>

      <div className="profile-setting">
        <span>{t('Appearance')}</span>
        <ThemeToggle />
      </div>

      <Button variant="danger" className="profile-logout" onClick={() => setConfirmingLogout(true)}>
        <Icon name="logout" size={17} />
        {t('Log out')}
      </Button>

      <Modal open={confirmingLogout} title={t('Log out of MABISA?')} onClose={() => setConfirmingLogout(false)}>
        <p className="logout-warning"><Icon name="warning" size={20} />{t('Make sure pending records are synchronized before leaving this device.')}</p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setConfirmingLogout(false)}>{t('Stay logged in')}</Button>
          <Button variant="danger" onClick={() => void logout()}><Icon name="logout" size={17} />{t('Log out')}</Button>
        </div>
      </Modal>
    </Card>
  );
}

export function SupplyDisbursementPage() {
  const navigate = useNavigate();
  const { snapshot, refreshLocalData, setMessage } = useMabisaData();

  return (
    <SupplyDisbursementForm
      individualCount={snapshot.individualCount}
      inventoryItems={snapshot.inventoryItems}
      onSaved={async () => {
        await refreshLocalData();
        setMessage('Pending Sync. Supply release was saved and stock was updated on this device.');
        navigate('/bhw');
      }}
    />
  );
}
