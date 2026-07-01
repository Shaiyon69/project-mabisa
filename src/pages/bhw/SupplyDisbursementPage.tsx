import { useNavigate } from 'react-router-dom';
import { useMabisaData } from '../../app/mabisaData';
import { SupplyDisbursementForm } from '../../components/bhw/SupplyDisbursementForm';

export function SupplyDisbursementPage() {
  const navigate = useNavigate();
  const { snapshot, refreshLocalData, setMessage } = useMabisaData();

  return (
    <SupplyDisbursementForm
      residents={snapshot.residents}
      inventoryItems={snapshot.inventoryItems}
      onSaved={async () => {
        await refreshLocalData();
        setMessage('Pending Sync. Supply release was saved and inventory stock was updated locally.');
        navigate('/bhw');
      }}
    />
  );
}
