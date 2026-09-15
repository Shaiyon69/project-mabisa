import { useState } from 'react';
import type { InventoryItemRow } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { fetchInventoryPage, reorderLevelOf, type AdminFilters } from '../../services/adminData';
import { useServerPage } from '../../hooks/useServerPage';
import { FormField } from '../common/FormField';
import { ErrorState } from '../common/StateMessage';
import { Table, TableBadge, TableMeta, TablePager, TableToolbar, type TableColumn } from '../common/Table';

type InventoryTableProps = {
  filters: AdminFilters;
  /** Stock is held per barangay, so a view across barangays names each row's; otherwise rows read as duplicates. */
  spansBarangays: boolean;
  /** Bumped after a stock movement, so the page in view re-reads. */
  reloadToken: number;
};

export function InventoryTable({ filters, spansBarangays, reloadToken }: InventoryTableProps) {
  const [query, setQuery] = useState('');
  const scopeKey = [query, filters.barangayId, filters.itemType, filters.stockLevel].join('|');
  const { rows, total, error, loading, page, pageCount, setPage, offset } = useServerPage(
    scopeKey,
    (limit, start) => fetchInventoryPage(query, filters, limit, start),
    { reloadToken, delayMs: 300 },
  );
  const columns: TableColumn<InventoryItemRow>[] = [
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
            render: (item: InventoryItemRow) => item.barangay_name ?? 'Unassigned',
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
      render: (item) => <TableBadge label={item.is_low ? 'Low Stock' : 'Sufficient'} tone={item.is_low ? 'warning' : 'success'} />,
    },
  ];

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
      {error ? <ErrorState title="Could not read the supplies" text={error} /> : null}
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(item) => item.item_id}
        numbered
        startIndex={offset}
        busy={loading}
        emptyTitle={loading ? 'Loading the supplies' : query ? 'No item matches' : 'No supplies yet'}
        emptyText={
          loading
            ? 'One moment.'
            : query
              ? 'Try a different item name or type.'
              : 'Nothing has been stocked yet. A barangay administrator adds supplies on this screen.'
        }
      />
      <TableMeta shown={rows.length} total={total} label="items" />
      {pageCount > 1 ? <TablePager page={page} pageCount={pageCount} onPage={setPage} disabled={loading} /> : null}
    </div>
  );
}
