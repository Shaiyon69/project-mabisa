import { useMabisaData } from '../../app/mabisaData';
import { AdminDashboard } from '../../components/admin/AdminDashboard';
import { PageHeader } from '../../components/common/PageHeader';

export function AdminDashboardPage() {
  const { snapshot } = useMabisaData();

  return (
    <>
      <PageHeader
        eyebrow="Admin overview"
        title="Barangay Monitoring Dashboard"
        description="Desktop-first view of local resident profiles, health assessments, inventory, supply releases, and sync readiness."
      />
      <AdminDashboard snapshot={snapshot} />
    </>
  );
}
