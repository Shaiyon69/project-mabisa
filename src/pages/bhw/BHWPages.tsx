import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import type { Individual } from '../../types/database';
import { ageInYears, logDev, titleCase } from '../../lib/utils';
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
import { EmptyState, ErrorState } from '../../components/common/StateMessage';
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
        setMessage('Saved on this phone. It will be sent when you have signal.');
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
  const [readFailed, setReadFailed] = useState(false);

  // The same debounce, `current` guard and accessor the resident picker uses; this
  // screen only shows the whole list rather than one selection.
  useEffect(() => {
    let current = true;

    const timeoutId = setTimeout(() => {
      setSearching(true);
      // The one list that keeps former members, so a status set by mistake stays
      // reachable by name.
      readLocalIndividuals({ searchQuery: query, limit: 50, includeFormer: true })
        .then((rows) => {
          if (current) {
            setResults(rows);
            setReadFailed(false);
          }
        })
        .catch((cause: unknown) => {
          logDev('Resident list read failed', cause instanceof Error ? cause.message : cause);

          if (current) {
            setReadFailed(true);
          }
        })
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
          <p className="eyebrow">On this phone</p>
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
      ) : readFailed ? (
        <ErrorState
          title="Could not open this phone's records"
          text="Your residents are still saved. Search again to try once more."
        />
      ) : (
        <EmptyState
          title={searching ? 'Searching...' : 'No resident found'}
          text="Register a household to begin. It saves on this phone even with no signal."
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
          setMessage('Changes saved on this phone. They will be sent when you have signal.');
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
        setMessage('Health check saved on this phone. It will be sent when you have signal.');
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

  // getSession reads the cached session, so the account line renders on a phone
  // that has been offline all day; getUser would go to the network.
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
          <dt>Records on this phone</dt>
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
        <p className="logout-warning"><Icon name="warning" size={20} />Send your waiting records before you log out of this phone.</p>
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
        setMessage('Saved on this phone. Your stock was updated, and it will be sent when you have signal.');
        navigate('/bhw');
      }}
    />
  );
}
