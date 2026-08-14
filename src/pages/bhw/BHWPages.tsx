import { useNavigate } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import { BHWDashboard } from '../../components/bhw/BHWDashboard';
import { HealthAssessmentForm } from '../../components/bhw/HealthAssessmentForm';
import { HouseholdForm } from '../../components/bhw/HouseholdForm';
import { SupplyDisbursementForm } from '../../components/bhw/SupplyDisbursementForm';

export function BHWHomePage() {
  const { snapshot, isOnline, syncStatus, syncError, syncingManually, runManualSync, retryDeadLetters } =
    useMabisaData();

  return (
    <BHWDashboard
      snapshot={snapshot}
      isOnline={isOnline}
      syncStatus={syncStatus}
      syncError={syncError}
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
      individualCount={snapshot.individualCount} // Updated from residents
      onSaved={async () => {
        await refreshLocalData();
        setMessage('Pending Sync. Health assessment was saved on this device.');
        navigate('/bhw');
      }}
    />
  );
}

export function SupplyDisbursementPage() {
  const navigate = useNavigate();
  const { snapshot, refreshLocalData, setMessage } = useMabisaData();

  return (
    <SupplyDisbursementForm
      individualCount={snapshot.individualCount} // <-- Fix: Swapped to individualCount
      inventoryItems={snapshot.inventoryItems}
      onSaved={async () => {
        await refreshLocalData();
        setMessage('Pending Sync. Supply release was saved and inventory stock was updated locally.');
        navigate('/bhw');
      }}
    />
  );
}