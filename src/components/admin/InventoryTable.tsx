import { useMemo, useState } from 'react';
import type { InventoryItem } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { reorderLevelOf } from '../../services/adminData';
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
      header: 'At the barangay',
      render: (item) => item.current_stock,
    },
    {
      key: 'reorder-level',
      header: 'Warn at',
      // 0 is a real setting, not a missing one — the office turned the warning off.
      render: (item) => (item.reorder_level === 0 ? 'Off' : reorderLevelOf(item)),
    },
    {
      key: 'indicator',
      header: 'Indicator',
      // The item's own level, the same call the dashboard tile makes.
      render: (item) => {
        // Same rule as lowStockItems, including 0 meaning the warning is off.
        const level = reorderLevelOf(item);
        const isLow = level > 0 && item.current_stock <= level;

        return <TableBadge label={isLow ? 'Low Stock' : 'Sufficient'} tone={isLow ? 'warning' : 'success'} />;
      },
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
        emptyTitle={loading ? 'Loading the supplies' : 'No supplies yet'}
        emptyText={
          loading
            ? 'One moment.'
            : 'Nothing has been stocked yet. A barangay administrator adds supplies on this screen.'
        }
      />
      {/*
        No `limit`. It used to cut the list at ten with no pager, so an eleventh
        item was unreachable — harmless while nothing could create one, and a real
        loss now that a barangay administrator can. A barangay stocks tens of
        items, not thousands, and the search box above narrows them; server-side
        paging here would be machinery for a list that fits on a screen.
      */}
      <TableMeta shown={filteredItems.length} total={inventoryItems.length} label="items" />
    </div>
  );
}
