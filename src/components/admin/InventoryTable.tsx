import { useMemo, useState } from 'react';
import type { InventoryItem } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { LOW_STOCK_THRESHOLD } from '../../services/adminData';
import { FormField } from '../common/FormField';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

type InventoryTableProps = {
  inventoryItems: InventoryItem[];
  loading?: boolean;
};

export function InventoryTable({ inventoryItems, loading = false }: InventoryTableProps) {
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
      // One threshold, shared with the dashboard's low-stock tile and the
      // inventory report, so the badge and the alert count cannot disagree.
      render: (item) => (
        <TableBadge
          label={item.current_stock <= LOW_STOCK_THRESHOLD ? 'Low Stock' : 'Sufficient'}
          tone={item.current_stock <= LOW_STOCK_THRESHOLD ? 'warning' : 'success'}
        />
      ),
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
        emptyTitle={loading ? 'Reading central inventory' : 'No inventory rows'}
        emptyText={loading ? 'One moment.' : 'Inventory items in the central database will appear here.'}
        limit={10}
      />
      <TableMeta shown={Math.min(filteredItems.length, 10)} total={filteredItems.length} label="central inventory" />
    </div>
  );
}
