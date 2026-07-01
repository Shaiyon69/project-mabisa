import { useMemo, useState } from 'react';
import type { InventoryItem } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { Input } from '../common/Input';
import { TableWrapper } from '../common/TableWrapper';

type InventoryTableProps = {
  inventoryItems: InventoryItem[];
};

export function InventoryTable({ inventoryItems }: InventoryTableProps) {
  const [query, setQuery] = useState('');
  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return inventoryItems;
    }

    return inventoryItems.filter((item) => `${item.item_name} ${item.type}`.toLowerCase().includes(search));
  }, [inventoryItems, query]);

  return (
    <div className="table-stack">
      <Input label="Search inventory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Item name or type" />
      <TableWrapper>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Current Stock</th>
              <th>Indicator</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.slice(0, 10).map((item) => (
              <tr key={item.item_id}>
                <td>{item.item_name}</td>
                <td>{titleCase(item.type)}</td>
                <td>{item.current_stock}</td>
                <td>
                  <Badge label={item.current_stock <= 10 ? 'Low Stock' : 'Sufficient'} tone={item.current_stock <= 10 ? 'warning' : 'success'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredItems.length ? <EmptyState title="No inventory rows" text="Inventory records saved locally will appear here." /> : null}
      </TableWrapper>
      <p className="table-meta">Showing {Math.min(filteredItems.length, 10)} of {filteredItems.length} local inventory row(s).</p>
    </div>
  );
}
