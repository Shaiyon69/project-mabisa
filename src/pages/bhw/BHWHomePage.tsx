import { useMabisaData } from '../../app/mabisaData';
import { BHWDashboard } from '../../components/bhw/BHWDashboard';

export function BHWHomePage() {
  const { snapshot, isOnline, syncStatus, syncingManually, runManualSync } = useMabisaData();

  return (
    <BHWDashboard
      snapshot={snapshot}
      isOnline={isOnline}
      syncStatus={syncStatus}
      syncingManually={syncingManually}
      onManualSync={runManualSync}
    />
  );
}
