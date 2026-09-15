import { Link } from 'react-router-dom';
import { formatCount, titleCase } from '../../lib/utils';
import type { InventoryItem } from '../../types/database';

/** Items shown before the rest are left to the Inventory screen. */
const SHOWN = 8;

/** The emptiest low-stock items first, with a link to the full list once there are more than fit. */
export function LowStockList({ items, barangayId }: { items: InventoryItem[]; barangayId: string | null }) {
  const shown = [...items].sort((a, b) => a.current_stock - b.current_stock).slice(0, SHOWN);
  const rest = items.length - shown.length;

  return (
    <>
      <ul className="compact-list">
        {shown.map((item) => (
          <li key={item.item_id}>
            <span>{item.item_name}</span>
            <small>
              {item.current_stock} on hand • {titleCase(item.type)}
            </small>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <Link className="admin-link" to={`/admin/inventory?stock=low${barangayId ? `&barangay=${barangayId}` : ''}`}>
          See all {formatCount(items.length)} low-stock items
        </Link>
      ) : null}
    </>
  );
}
