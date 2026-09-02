import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import type { Individual } from '../../types/database';
import { ageInYears, titleCase } from '../../lib/utils';
import { readLocalIndividuals } from '../../services/localDatabase';
import { BHWDashboard } from '../../components/bhw/BHWDashboard';
import { HealthAssessmentForm } from '../../components/bhw/HealthAssessmentForm';
import { HouseholdForm } from '../../components/bhw/HouseholdForm';
import { ResidentDetail } from '../../components/bhw/ResidentDetail';
import { SupplyDisbursementForm } from '../../components/bhw/SupplyDisbursementForm';
import type { BhwOutletContext } from '../../components/bhw/BHWLayout';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { FormField } from '../../components/common/FormField';
import { Icon } from '../../components/common/Icon';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/StateMessage';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { supabase } from '../../lib/supabase';

export function BHWHomePage() {
  const { snapshot, isOnline, syncStatus, syncError, lastSyncAt, syncingManually, runManualSync, retryDeadLetters } =
    useMabisaData();
  // Signing out is how the app returns to the sign-in screen; the local database is untouched by it.
  const { logout } = useOutletContext<BhwOutletContext>();

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
      onSignInAgain={logout}
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

export function ResidentsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Individual[]>([]);
  const [searching, setSearching] = useState(false);

  // Same 300ms debounce, same `current` guard against a slow read landing after a
  // faster later one, and the same accessor the resident picker uses; this screen
  // only differs in showing the whole list rather than one selection.
  useEffect(() => {
    let current = true;

    const timeoutId = setTimeout(() => {
      setSearching(true);
      // The one list that keeps former members: a status set by mistake has to be
      // reachable, and looking someone up by name is how a BHW would go find them.
      readLocalIndividuals({ searchQuery: query, limit: 50, includeFormer: true })
        .then((rows) => {
          if (current) {
            setResults(rows);
          }
        })
        .catch(console.error)
        .finally(() => {
          if (current) {
            setSearching(false);
          }
        });
    }, 300);

    return () => {
      current = false;
      clearTimeout(timeoutId);
    };
  }, [query]);

  return (
    <Card className="list-section">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Registry</p>
          <h2>Residents</h2>
        </div>
      </div>

      <FormField
        label="Search residents"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name..."
      />

      {results.length ? (
        <ul className="compact-list resident-list">
          {results.map((person) => (
            <li key={person.resident_id}>
              <button type="button" onClick={() => navigate(`/bhw/residents/${person.resident_id}`)}>
                <span>
                  {person.last_name}, {person.first_name}
                  {person.is_household_head ? ' (Head)' : ''}
                  {person.status && person.status !== 'active' ? ` — ${titleCase(person.status)}` : ''}
                </span>
                <small>
                  {ageInYears(person.birthday) ?? '—'} years old
                  {person.household_number ? ` • ${person.household_number}` : ''}
                </small>
                <Icon name="chevron" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={searching ? 'Searching...' : 'No resident found'}
          text="Register a household to start the offline-first BHW workflow."
        />
      )}
    </Card>
  );
}

export function ResidentDetailPage() {
  const { residentId } = useParams<{ residentId: string }>();
  const { bhwId, snapshot, refreshLocalData, setMessage } = useMabisaData();

  return (
    <>
      <Link className="back-link" to="/bhw/residents">
        <Icon name="chevron" size={16} />
        Back to residents
      </Link>
      <ResidentDetail
        residentId={residentId ?? ''}
        inventoryItems={snapshot.inventoryItems}
        bhwId={bhwId}
        onSaved={async () => {
          await refreshLocalData();
          setMessage('Pending Sync. Profile changes were saved on this device.');
        }}
      />
    </>
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
  const { logout, fullName } = useOutletContext<BhwOutletContext>();
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
          <p className="eyebrow">Account</p>
          <h2>Profile</h2>
        </div>
      </div>

      <dl className="profile-facts">
        {/* The name first, then the account that carries it. A BHW checking this
            screen is confirming the phone is signed in as them, and a name
            answers that faster than an email address does. Falls back to the
            email rather than a dash: an account with no profile row yet still
            has something to identify it by. */}
        <div>
          <dt>Name</dt>
          <dd>{fullName ?? email ?? '—'}</dd>
        </div>
        <div>
          <dt>Signed in as</dt>
          <dd>{email ?? '—'}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>Barangay Health Worker</dd>
        </div>
        <div>
          <dt>Records on this device</dt>
          <dd>{snapshot.householdCount + snapshot.individualCount}</dd>
        </div>
      </dl>

      <div className="profile-setting">
        <span>Appearance</span>
        <ThemeToggle />
      </div>

      <Button variant="danger" className="profile-logout" onClick={() => setConfirmingLogout(true)}>
        <Icon name="logout" size={17} />
        Log out
      </Button>

      <Modal open={confirmingLogout} title="Log out of BRHP-MSAM?" onClose={() => setConfirmingLogout(false)}>
        <p className="logout-warning"><Icon name="warning" size={20} />Make sure pending records are synchronized before leaving this device.</p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setConfirmingLogout(false)}>Stay logged in</Button>
          <Button variant="danger" onClick={() => void logout()}><Icon name="logout" size={17} />Log out</Button>
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
