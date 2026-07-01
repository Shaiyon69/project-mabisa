import { useMabisaData } from '../../app/mabisaData';
import { ResidentsTable } from '../../components/admin/ResidentsTable';
import { Card } from '../../components/common/Card';
import { PageHeader } from '../../components/common/PageHeader';

export function ResidentsPage() {
  const { snapshot } = useMabisaData();

  return (
    <>
      <PageHeader eyebrow="Residents" title="Resident Registry" description="Search and review resident profiles saved on this device." />
      <Card className="admin-monitor">
        <ResidentsTable residents={snapshot.residents} pendingQueueCount={snapshot.pendingQueueCount} />
      </Card>
    </>
  );
}
