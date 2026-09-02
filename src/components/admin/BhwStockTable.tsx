import { useEffect, useState } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import { fetchAccounts, fetchBhwStock } from '../../services/adminData';
import type { BhwItemStock } from '../../types/database';
import { ErrorState } from '../common/StateMessage';
import { Table, TableMeta, type TableColumn } from '../common/Table';


/**
 * What each health worker is still carrying, read from the `bhw_item_stock` view
 * so the arithmetic is the database's. `inventory_items.current_stock` is a
 * different number, the barangay's unallocated remainder, and is labelled apart.
 */
export function BhwStockTable({ reloadToken }: { reloadToken: number }) {
  const [rows, setRows] = useState<BhwItemStock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let current = true;

    Promise.all([fetchBhwStock(), fetchAccounts()])
      .then(([stock, accounts]) => {
        if (current) {
          setRows(stock);
          setNames(new Map(accounts.map((account) => [account.profile.user_id, account.profile.full_name])));
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setError(cause instanceof Error ? cause.message : 'Could not read carried stock.');
        }
      });

    return () => {
      current = false;
    };
  }, [reloadToken]);

  const columns: TableColumn<BhwItemStock>[] = [
    {
      key: 'bhw',
      header: 'Health worker',
      // An id when the name is not readable: a blank cell reads as no allocation.
      render: (row) => names.get(row.bhw_id) ?? row.bhw_id,
    },
    { key: 'item', header: 'Item', render: (row) => row.item_name },
    { key: 'type', header: 'Type', render: (row) => titleCase(row.type) },
    { key: 'carried', header: 'Still carried', render: (row) => row.current_stock },
    { key: 'updated', header: 'Last movement', render: (row) => formatDate(row.updated_at) },
  ];

  return (
    <div className="ui-table-stack">
      {error ? <ErrorState title="Could not read carried stock" text={error} /> : null}
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(row) => `${row.bhw_id}:${row.item_id}`}
        emptyTitle="Nothing allocated yet"
        emptyText="Stock handed to a health worker appears here, less whatever they have already released."
      />
      <TableMeta shown={rows.length} total={rows.length} label="carried stock" />
    </div>
  );
}
