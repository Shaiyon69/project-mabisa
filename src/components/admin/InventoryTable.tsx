import { useMemo, useState } from 'react';
import type { InventoryItem } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { FormField } from '../common/FormField';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

type InventoryTableProps = {
  inventoryItems: InventoryItem[];
};

export function InventoryTable({ inventoryItems }: InventoryTableProps) {
  const [query, setQuery] = useState('');
  const columns: TableColumn<InventoryItem>[] = [
    {
      key: 'item',
      header: 'Item',
      render: (item) => item.item_name,
    },
    {
      key: 'type',
      header: 'Type',
      render: (item) => titleCase(item.type),
    },
    {
      key: 'current-stock',
      header: 'Current Stock',
      render: (item) => item.current_stock,
    },
    {
      key: 'indicator',
      header: 'Indicator',
      render: (item) => <TableBadge label={item.current_stock <= 10 ? 'Low Stock' : 'Sufficient'} tone={item.current_stock <= 10 ? 'warning' : 'success'} />,
    },
  ];
  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return inventoryItems;
    }

    return inventoryItems.filter((item) => `${item.item_name} ${item.type}`.toLowerCase().includes(search));
  }, [inventoryItems, query]);

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <FormField label="Search inventory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Item name or type" />
      </TableToolbar>
      <Table
        columns={columns}
        rows={filteredItems}
        getRowKey={(item) => item.item_id}
        emptyTitle="No inventory rows"
        emptyText="Inventory records saved locally will appear here."
        limit={10}
      />
      <TableMeta shown={Math.min(filteredItems.length, 10)} total={filteredItems.length} label="inventory" />
    </div>
  );
}
