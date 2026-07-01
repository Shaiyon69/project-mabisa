import { AccountsTable } from '../../components/admin/AccountsTable';
import { Card } from '../../components/common/Card';
import { PageHeader } from '../../components/common/PageHeader';

export function AccountsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Accounts"
        title="Account Management"
        description="Prepared admin surface for user accounts while preserving the existing authentication implementation."
      />
      <Card className="admin-monitor">
        <AccountsTable />
      </Card>
    </>
  );
}
