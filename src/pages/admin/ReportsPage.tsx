import { useMabisaData } from '../../app/mabisaData';
import { ReportCards } from '../../components/admin/ReportCards';
import { Card } from '../../components/common/Card';
import { PageHeader } from '../../components/common/PageHeader';

export function ReportsPage() {
  const { snapshot } = useMabisaData();

  return (
    <>
      <PageHeader eyebrow="Reports" title="Reports and Analytics" description="Review recent nutrition and supply allocation activity from local records." />
      <Card className="activity-panel">
        <ReportCards assessments={snapshot.assessments} disbursements={snapshot.disbursements} />
      </Card>
    </>
  );
}
