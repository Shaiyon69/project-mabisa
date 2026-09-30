import { useState } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import { fetchBhwStockPage } from '../../services/adminData';
import { useServerPage } from '../../hooks/useServerPage';
import type { BhwItemStock } from '../../types/database';
import { ErrorState } from '../common/StateMessage';
import { Table, TableMeta, TablePager, type TableColumn, type TableSort } from '../common/Table';

type CarriedStock = BhwItemStock & { bhw_name: string | null };

const columns: TableColumn<CarriedStock>[] = [
  {
    key: 'bhw',
    header: 'Health worker',
    // An id when the name is not readable: a blank cell reads as no allocation.
    render: (row) => row.bhw_name ?? row.bhw_id,
  },
  { key: 'item', header: 'Item', sortBy: 'item_name', render: (row) => row.item_name },
  { key: 'type', header: 'Type', sortBy: 'type', render: (row) => titleCase(row.type) },
  { key: 'carried', header: 'Still carried', numeric: true, sortBy: 'current_stock', render: (row) => row.current_stock },
  { key: 'updated', header: 'Last movement', sortBy: 'updated_at', render: (row) => formatDate(row.updated_at) },
];

/**
 * What each health worker is still carrying, read from the `bhw_item_stock` view
 * so the arithmetic is the database's. `inventory_items.current_stock` is a
 * different number, the barangay's unallocated remainder, and is labelled apart.
 */
export function BhwStockTable({ reloadToken }: { reloadToken: number }) {
  const [sort, setSort] = useState<TableSort | null>(null);
  const { rows, total, error, loading, page, pageCount, setPage, offset } = useServerPage(
    ['carried', sort?.column, sort?.ascending].join('|'),
    (limit, start) => fetchBhwStockPage(limit, start, sort),
    { reloadToken },
  );

  return (
    <div className="ui-table-stack">
      {error ? <ErrorState title="Could not read carried stock" text={error} /> : null}
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(row) => `${row.bhw_id}:${row.item_id}`}
        numbered
        startIndex={offset}
        busy={loading}
        sort={sort}
        onSort={setSort}
        emptyTitle={loading ? 'Loading carried stock' : 'Nothing given out yet'}
        emptyText={
          loading ? 'One moment.' : 'Stock handed to a health worker appears here, less whatever they have already released.'
        }
      />
      <TableMeta shown={rows.length} total={total} label="items" />
      {pageCount > 1 ? <TablePager page={page} pageCount={pageCount} onPage={setPage} disabled={loading} /> : null}
    </div>
  );
}
