import { useEffect, useState } from 'react';
import {
  allocateStockToBhw,
  createInventoryItem,
  fetchAllocatableBhws,
  restockInventoryItem,
  type AccountRow,
} from '../../services/adminData';
import type { InventoryItem, InventoryItemType } from '../../types/database';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormField, SelectField } from '../common/FormField';
import { ErrorState } from '../common/StateMessage';

const ITEM_TYPES: InventoryItemType[] = ['medicine', 'food', 'equipment', 'hygiene', 'other'];

type InventoryControlsProps = {
  items: InventoryItem[];
  /** Refetch the snapshot, so the table reflects what the RPC just did. */
  onChanged: () => void;
};

/**
 * Stock management, for a barangay administrator only.
 *
 * Two things happen here and they are deliberately separate. **Receiving** adds
 * to what the barangay holds. **Allocating** moves a quantity out of that and
 * into one named BHW's hands, which is the only way a field device ever comes to
 * have anything to release. The number in the table is what is left after
 * allocations, not the total that exists.
 *
 * Every submission goes to a database function that re-checks the same rules, so
 * this component's job is to make a refusal readable rather than to be the thing
 * that prevents it.
 */
export function InventoryControls({ items, onChanged }: InventoryControlsProps) {
  const [bhws, setBhws] = useState<AccountRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    fetchAllocatableBhws()
      .then((rows) => current && setBhws(rows))
      .catch((cause: unknown) => current && setLoadError(cause instanceof Error ? cause.message : 'Could not read health worker accounts.'));

    return () => {
      current = false;
    };
  }, []);

  return (
    <div className="dashboard-grid">
      {loadError ? <ErrorState title="Could not read health worker accounts" text={loadError} /> : null}
      <ReceiveStockCard items={items} onChanged={onChanged} />
      <AllocateStockCard items={items} bhws={bhws} onChanged={onChanged} />
    </div>
  );
}

/** Adding an item the barangay did not stock before, or more of one it did. */
function ReceiveStockCard({ items, onChanged }: InventoryControlsProps) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [itemName, setItemName] = useState('');
  const [itemType, setItemType] = useState<InventoryItemType>('medicine');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const { busy, message, error, run } = useStockAction(onChanged);

  const amount = Number(quantity);
  const amountValid = Number.isInteger(amount) && amount >= (mode === 'new' ? 0 : 1);

  return (
    <Card className="report-card">
      <h3>Receive stock</h3>
      <p className="muted">Supplies delivered to the barangay. Nothing here reaches a health worker until it is allocated below.</p>

      <SelectField label="What arrived" value={mode} onChange={(event) => setMode(event.target.value as 'new' | 'existing')}>
        <option value="new">An item not stocked before</option>
        <option value="existing">More of an item already listed</option>
      </SelectField>

      {mode === 'new' ? (
        <>
          <FormField label="Item name" value={itemName} placeholder="Paracetamol 500mg" onChange={(event) => setItemName(event.target.value)} />
          <SelectField label="Type" value={itemType} onChange={(event) => setItemType(event.target.value as InventoryItemType)}>
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </SelectField>
          <FormField
            label="Opening quantity"
            type="number"
            min={0}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            hint="Zero is allowed — the item is listed now and stocked later."
          />
        </>
      ) : (
        <>
          <ItemSelect items={items} value={itemId} onChange={setItemId} />
          <FormField label="Quantity received" type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          <FormField
            label="Reason"
            value={reason}
            placeholder="Monthly delivery from the RHU"
            onChange={(event) => setReason(event.target.value)}
            hint="Recorded against the item, so the count can be explained later."
          />
        </>
      )}

      <StockActionFooter
        busy={busy}
        message={message}
        error={error}
        label={mode === 'new' ? 'Add item' : 'Add stock'}
        disabled={
          !amountValid || (mode === 'new' ? itemName.trim() === '' : itemId === '' || reason.trim() === '')
        }
        onSubmit={() =>
          run(async () => {
            if (mode === 'new') {
              await createInventoryItem(itemName.trim(), itemType, amount);
              setItemName('');
            } else {
              await restockInventoryItem(itemId, amount, reason.trim());
              setReason('');
            }

            setQuantity('');
          })
        }
      />
    </Card>
  );
}

/** Handing a quantity to one BHW. This is what a phone eventually pulls as its own stock. */
function AllocateStockCard({ items, bhws, onChanged }: InventoryControlsProps & { bhws: AccountRow[] }) {
  const [itemId, setItemId] = useState('');
  const [bhwId, setBhwId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const { busy, message, error, run } = useStockAction(onChanged);

  const amount = Number(quantity);
  const selected = items.find((item) => item.item_id === itemId);
  const overStock = Boolean(selected) && amount > (selected?.current_stock ?? 0);

  return (
    <Card className="report-card">
      <h3>Allocate to a health worker</h3>
      <p className="muted">
        Moves stock out of the barangay's holding and into one BHW's. They can release only what they have been given.
      </p>

      <ItemSelect items={items} value={itemId} onChange={setItemId} />

      <SelectField
        label="Health worker"
        value={bhwId}
        onChange={(event) => setBhwId(event.target.value)}
        hint={bhws.length === 0 ? 'No health worker in this barangay has a purok assignment yet.' : undefined}
      >
        <option value="">Select a health worker</option>
        {bhws.map((account) => (
          <option key={account.profile.user_id} value={account.profile.user_id}>
            {account.profile.full_name} — {account.purokName}
          </option>
        ))}
      </SelectField>

      <FormField
        label="Quantity"
        type="number"
        min={1}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        error={overStock ? `Only ${selected?.current_stock} unallocated.` : undefined}
      />

      <FormField label="Reason" value={reason} placeholder="Weekly field allocation" onChange={(event) => setReason(event.target.value)} />

      <StockActionFooter
        busy={busy}
        message={message}
        error={error}
        label="Allocate"
        disabled={!itemId || !bhwId || !Number.isInteger(amount) || amount < 1 || overStock || reason.trim() === ''}
        onSubmit={() =>
          run(async () => {
            await allocateStockToBhw(itemId, bhwId, amount, reason.trim());
            setQuantity('');
            setReason('');
          })
        }
      />
    </Card>
  );
}

function ItemSelect({ items, value, onChange }: { items: InventoryItem[]; value: string; onChange: (value: string) => void }) {
  return (
    <SelectField label="Item" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select an item</option>
      {items.map((item) => (
        <option key={item.item_id} value={item.item_id}>
          {item.item_name} ({item.current_stock} unallocated)
        </option>
      ))}
    </SelectField>
  );
}

/**
 * The submit half of both cards: one in-flight guard, and the database's own
 * refusal shown verbatim rather than replaced with a generic failure. The RPCs
 * raise sentences meant to be read ("Only 12 of Paracetamol is unallocated"),
 * and rewriting those into "Something went wrong" throws away the only part that
 * tells an administrator what to do next.
 */
function useStockAction(onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      await action();
      setMessage('Saved.');
      onChanged();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The change was not saved.');
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, error, run };
}

function StockActionFooter({
  busy,
  message,
  error,
  label,
  disabled,
  onSubmit,
}: {
  busy: boolean;
  message: string | null;
  error: string | null;
  label: string;
  disabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <>
      {error ? <p className="alert">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}
      <Button onClick={onSubmit} disabled={busy || disabled}>
        {busy ? 'Saving' : label}
      </Button>
    </>
  );
}
