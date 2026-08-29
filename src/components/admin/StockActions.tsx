import { useEffect, useState } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import {
  allocateStock,
  createInventoryItem,
  fetchAccounts,
  fetchBhwStock,
  restockItem,
  type AccountRow,
} from '../../services/adminData';
import type { BhwItemStock, InventoryItem, InventoryItemType } from '../../types/database';
import { Button } from '../common/Button';
import { FormField, SelectField, TextAreaField } from '../common/FormField';
import { Modal } from '../common/Modal';
import { ErrorState } from '../common/StateMessage';
import { Table, TableMeta, type TableColumn } from '../common/Table';

const ITEM_TYPES: InventoryItemType[] = ['medicine', 'food', 'equipment', 'hygiene', 'other'];

type StockActionsProps = {
  items: InventoryItem[];
  /** Re-reads the snapshot after a successful movement. */
  onChanged: () => void;
};

/** Which dialog is open. One value, so two can never be. */
type OpenDialog = 'allocate' | 'restock' | 'create' | null;

/**
 * The three stock movements a barangay admin can make, each behind a dialog.
 *
 * Nothing here writes a table. All three go through `barangay_admin_*` RPCs,
 * which assert an active barangay admin, move the stock and write the audit
 * event in one transaction — the tables withhold the grants that would let a
 * direct write succeed at anything except losing the audit trail. Allocation
 * additionally refuses to hand out more than the barangay holds and refuses a
 * BHW from another barangay, both checked inside the function, so this form
 * never has to decide either and never has to be trusted to.
 *
 * Allocating and restocking take a required reason in the same dialog as the
 * act, because that reason is what the audit row carries; an audit trail whose
 * every entry reads "update" is worth nothing. Each confirm button names the
 * act rather than saying Apply.
 */
export function StockActions({ items, onChanged }: StockActionsProps) {
  const [open, setOpen] = useState<OpenDialog>(null);
  const [bhws, setBhws] = useState<AccountRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [itemId, setItemId] = useState('');
  const [bhwId, setBhwId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemType, setItemType] = useState<InventoryItemType>('medicine');

  // Only the accounts an allocation can legally name. The RPC rejects the rest,
  // so offering them is offering a button that can only fail.
  useEffect(() => {
    let current = true;

    fetchAccounts()
      .then((accounts) => {
        if (current) {
          setBhws(accounts.filter((account) => account.profile.role === 'bhw' && account.profile.is_active));
        }
      })
      .catch(() => {
        // A failed account read is not an error on this screen — it disables the
        // allocate dialog's picker, which says the same thing more usefully.
      });

    return () => {
      current = false;
    };
  }, []);

  function close() {
    setOpen(null);
    setError(null);
    setItemId('');
    setBhwId('');
    setQuantity('');
    setReason('');
    setItemName('');
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);

    try {
      await action();
      onChanged();
      close();
    } catch (cause: unknown) {
      // The RPC's own message — "Only 4 of Paracetamol is unallocated" — is the
      // most useful thing this dialog can say, so it is shown verbatim rather
      // than replaced with a generic failure.
      setError(cause instanceof Error ? cause.message : 'The stock movement was refused.');
    } finally {
      setBusy(false);
    }
  }

  const amount = Number(quantity);
  const validAmount = Number.isInteger(amount) && amount > 0;
  const selected = items.find((item) => item.item_id === itemId);

  return (
    <>
      <Button onClick={() => setOpen('allocate')}>Allocate to BHW</Button>
      <Button variant="secondary" onClick={() => setOpen('restock')}>
        Restock
      </Button>
      <Button variant="secondary" onClick={() => setOpen('create')}>
        New item
      </Button>

      <Modal open={open === 'allocate'} title="Allocate stock to a health worker" onClose={close}>
        <SelectField label="Item" value={itemId} onChange={(event) => setItemId(event.target.value)}>
          <option value="">Select an item</option>
          {items.map((item) => (
            <option key={item.item_id} value={item.item_id}>
              {item.item_name} — {item.current_stock} unallocated
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Health worker"
          value={bhwId}
          onChange={(event) => setBhwId(event.target.value)}
          hint={bhws.length ? undefined : 'No active BHW accounts were readable.'}
        >
          <option value="">Select a health worker</option>
          {bhws.map((account) => (
            <option key={account.profile.user_id} value={account.profile.user_id}>
              {account.profile.full_name}
              {account.purokName ? ` — ${account.purokName}` : ' — no purok assigned'}
            </option>
          ))}
        </SelectField>
        <FormField
          label="Quantity"
          type="number"
          min={1}
          step={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          hint={selected ? `${selected.current_stock} unallocated at the barangay.` : undefined}
        />
        <TextAreaField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="Recorded on the audit event for this allocation."
        />
        {error ? <ErrorState title="Allocation refused" text={error} /> : null}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !itemId || !bhwId || !validAmount || !reason.trim()}
            onClick={() => void run(() => allocateStock(itemId, bhwId, amount, reason.trim()))}
          >
            {busy ? 'Allocating…' : 'Allocate stock'}
          </Button>
        </div>
      </Modal>

      <Modal open={open === 'restock'} title="Record a restock" onClose={close}>
        <SelectField label="Item" value={itemId} onChange={(event) => setItemId(event.target.value)}>
          <option value="">Select an item</option>
          {items.map((item) => (
            <option key={item.item_id} value={item.item_id}>
              {item.item_name} — {item.current_stock} unallocated
            </option>
          ))}
        </SelectField>
        <FormField
          label="Quantity received"
          type="number"
          min={1}
          step={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <TextAreaField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="Where the stock came from — recorded on the audit event."
        />
        {error ? <ErrorState title="Restock refused" text={error} /> : null}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !itemId || !validAmount || !reason.trim()}
            onClick={() => void run(() => restockItem(itemId, amount, reason.trim()))}
          >
            {busy ? 'Recording…' : 'Record restock'}
          </Button>
        </div>
      </Modal>

      <Modal open={open === 'create'} title="Add an inventory item" onClose={close}>
        <FormField label="Item name" value={itemName} onChange={(event) => setItemName(event.target.value)} />
        <SelectField
          label="Type"
          value={itemType}
          onChange={(event) => setItemType(event.target.value as InventoryItemType)}
        >
          {ITEM_TYPES.map((type) => (
            <option key={type} value={type}>
              {titleCase(type)}
            </option>
          ))}
        </SelectField>
        <FormField
          label="Opening stock"
          type="number"
          min={0}
          step={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          hint="How many units the barangay holds today. Zero is fine."
        />
        {error ? <ErrorState title="Item not created" text={error} /> : null}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !itemName.trim() || !Number.isInteger(Number(quantity)) || Number(quantity) < 0}
            onClick={() => void run(() => createInventoryItem(itemName.trim(), itemType, Number(quantity)))}
          >
            {busy ? 'Adding…' : 'Add item'}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/**
 * What each health worker is still carrying.
 *
 * Read from the `bhw_item_stock` view rather than subtracted here: allocations
 * minus releases is the database's arithmetic, so the portal cannot disagree
 * with the phone about how much a health worker has left. `inventory_items.
 * current_stock` is a different number — the barangay's *unallocated* remainder
 * — and the two are labelled apart on purpose.
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
      // An id is shown when the name is not readable rather than nothing at all:
      // a blank cell reads as an empty allocation.
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
