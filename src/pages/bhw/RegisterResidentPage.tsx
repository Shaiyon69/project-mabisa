import { useNavigate } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import { ResidentForm } from '../../components/bhw/ResidentForm';

export function RegisterResidentPage() {
  const navigate = useNavigate();
  const { bhwId, refreshLocalData, setMessage } = useMabisaData();

  return (
    <ResidentForm
      bhwId={bhwId}
      onSaved={async () => {
        await refreshLocalData();
        setMessage('Saved Offline. Resident profile is queued for sync.');
        navigate('/bhw');
      }}
    />
  );
}
