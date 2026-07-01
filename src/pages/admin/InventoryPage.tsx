import { useMabisaData } from '../../app/mabisaData';
import { InventoryTable } from '../../components/admin/InventoryTable';
import { Card } from '../../components/common/Card';
import { PageHeader } from '../../components/common/PageHeader';

export function InventoryPage() {
  const { snapshot } = useMabisaData();

  return (
    <>
      <PageHeader eyebrow="Inventory" title="Supply Inventory" description="Monitor local supply stock levels and low-stock indicators." />
      <Card className="admin-monitor">
        <InventoryTable inventoryItems={snapshot.inventoryItems} />
      </Card>
    </>
  );
}
