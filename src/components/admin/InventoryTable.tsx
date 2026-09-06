import { useMemo, useState } from 'react';
import type { Barangay, InventoryItem } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { lowStockItems, reorderLevelOf } from '../../services/adminData';
import { FormField } from '../common/FormField';
import { ROWS_PER_PAGE, Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

type InventoryTableProps = {
  inventoryItems: InventoryItem[];
  /** Names for the barangay column, which only an unscoped RHU view shows. */
  barangays?: Barangay[];
  loading?: boolean;
};

export function InventoryTable({ inventoryItems, barangays = [], loading = false }: InventoryTableProps) {
  const [query, setQuery] = useState('');
  // Stock is held per barangay, so an RHU account reading every barangay gets one
  // row per barangay per item. Without this column those read as duplicates.
  const spansBarangays = new Set(inventoryItems.map((item) => item.barangay_id)).size > 1;
  const barangayName = useMemo(() => new Map(barangays.map((barangay) => [barangay.barangay_id, barangay.name])), [barangays]);
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
    ...(spansBarangays
      ? [
          {
            key: 'barangay',
            header: 'Barangay',
            render: (item: InventoryItem) => barangayName.get(item.barangay_id ?? '') ?? 'Unassigned',
          },
        ]
      : []),
    {
      key: 'current-stock',
      header: 'At the barangay',
      numeric: true,
      render: (item) => item.current_stock,
    },
    {
      key: 'reorder-level',
      header: 'Warn at',
      numeric: true,
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
  // Low stock first: what needs restocking should not be a page away.
  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();
    const low = new Set(lowStockItems(inventoryItems).map((item) => item.item_id));
    const matches = search
      ? inventoryItems.filter((item) =>
          `${item.item_name} ${item.type} ${barangayName.get(item.barangay_id ?? '') ?? ''}`
            .toLowerCase()
            .includes(search),
        )
      : inventoryItems;

    return [...matches].sort((a, b) => Number(low.has(b.item_id)) - Number(low.has(a.item_id)));
  }, [inventoryItems, query, barangayName]);

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <FormField
          label="Search inventory"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={spansBarangays ? 'Item, type or barangay' : 'Item name or type'}
        />
      </TableToolbar>
      <Table
        columns={columns}
        rows={filteredItems}
        getRowKey={(item) => item.item_id}
        pageSize={ROWS_PER_PAGE}
        numbered
        emptyTitle={loading ? 'Loading the supplies' : 'No supplies yet'}
        emptyText={
          loading
            ? 'One moment.'
            : 'Nothing has been stocked yet. A barangay administrator adds supplies on this screen.'
        }
      />
      {/*
        Paged in the browser, not on the server. It used to cut the list at ten with
        no pager, so an eleventh item was unreachable. An RHU account reads every
        barangay's items, which is hundreds of rows, but not the thousands that
        would need the server to do the paging.
      */}
      <TableMeta shown={filteredItems.length} total={inventoryItems.length} label="items" />
    </div>
  );
}
