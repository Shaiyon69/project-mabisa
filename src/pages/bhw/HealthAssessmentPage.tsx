import { useNavigate } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import { HealthAssessmentForm } from '../../components/bhw/HealthAssessmentForm';

export function HealthAssessmentPage() {
  const navigate = useNavigate();
  const { snapshot, refreshLocalData, setMessage } = useMabisaData();

  return (
    <HealthAssessmentForm
      residents={snapshot.residents}
      onSaved={async () => {
        await refreshLocalData();
        setMessage('Pending Sync. Health assessment was saved on this device.');
        navigate('/bhw');
      }}
    />
  );
}
