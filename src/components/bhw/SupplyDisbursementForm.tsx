import { useRef, useState } from 'react';
import type { InventoryItem, SupplyDisbursement } from '../../types/database'; 
import { createId, describeMissing, ignoreImplicitSubmit, isInFuture, scrollToFirstError, today } from '../../lib/utils';
import { saveSupplyDisbursementLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField } from '../common/FormField';
import { Combobox } from '../common/Combobox';
import { IndividualSearch } from './IndividualSearch';
import { Icon } from '../common/Icon';

type SupplyDisbursementFormProps = {
  individualCount: number; 
  inventoryItems: InventoryItem[];
  onSaved: () => Promise<void>;
};

export function SupplyDisbursementForm({ individualCount, inventoryItems, onSaved }: SupplyDisbursementFormProps) {
  const [residentId, setResidentId] = useState('');
  // Falls back to the first item each render, not just at mount, since
  // `inventoryItems` loads asynchronously and is typically still empty then.
  const [selectedItemId, setSelectedItemId] = useState('');
  const itemId = selectedItemId || inventoryItems[0]?.item_id || '';
  const [quantity, setQuantity] = useState('1');
  const [disbursementDate, setDisbursementDate] = useState(today());

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  const hasIndividuals = individualCount > 0;
  const hasInventory = inventoryItems.length > 0;
  const selectedItem = inventoryItems.find((item) => item.item_id === itemId);
  const requestedQuantity = Number(quantity);
  const missingRequirements = [
    !hasIndividuals && 'a registered resident',
    !residentId && 'the resident receiving the supply',
    !hasInventory && 'stock to give out',
    !itemId && 'the item being given',
    // Whole units: the column is an integer, and `noValidate` means the step
    // attribute is not the guard it looks like.
    (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) && 'a whole number, 1 or more',
    selectedItem && requestedQuantity > selectedItem.current_stock && 'a quantity you actually have',
    !disbursementDate && 'the date',
    isInFuture(disbursementDate) && 'a date on or before today',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;
  // Minted once and held until the row lands, so a retry updates the same release
  // rather than decrementing stock twice.
  const pendingId = useRef<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setFormError(null);
    
    if (!isFormReady) {
      setFormError(describeMissing(missingRequirements));
      scrollToFirstError();
      return;
    }

    setSaving(true);
    const timestamp = new Date().toISOString();

    pendingId.current ??= createId();

    const disbursement: SupplyDisbursement = {
      log_id: pendingId.current,
      resident_id: residentId,
      item_id: itemId,
      quantity: Number(quantity),
      disbursement_date: disbursementDate,
      created_at: timestamp,
      updated_at: timestamp,
    };

    try {
      await saveSupplyDisbursementLocally(disbursement);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'This supply release was not saved.');
      scrollToFirstError();
      setSaving(false);
      return;
    }

    // The release is recorded and the stock decremented, so nothing below may
    // report it as unsaved.
    pendingId.current = null;
    setResidentId('');
    setQuantity('1');
    setSaving(false);

    try {
      await onSaved();
    } catch {
      setFormError('The release was recorded. The screen did not refresh, but the record is on this phone.');
    }
  }

  return (
    <Card className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Supplies</p>
          <h2>Give Out Supplies</h2>
        </div>
        <div className="header-actions">
          <Badge label={hasIndividuals ? 'Residents ready' : 'No residents yet'} tone={hasIndividuals ? 'success' : 'warning'} />
          <Badge label={hasInventory ? 'You have stock' : 'No stock'} tone={hasInventory ? 'success' : 'danger'} />
        </div>
      </div>

      <form className="stack" onSubmit={handleSubmit} onKeyDown={ignoreImplicitSubmit} noValidate>
        {formError ? <p className="form-alert" role="alert"><Icon name="warning" size={18} />{formError}</p> : null}

        <IndividualSearch selectedResidentId={residentId} onChange={setResidentId} error={showValidation && !residentId ? 'Select a resident.' : undefined} />
        {!hasIndividuals ? <p className="form-hint">Register a household first.</p> : null}

        <Combobox
          label="Item"
          required
          value={itemId}
          options={inventoryItems.map((item) => ({
            value: item.item_id,
            label: `${item.item_name} (${item.current_stock} in stock)`,
          }))}
          onChange={setSelectedItemId}
          placeholder="Search item..."
          disabled={!hasInventory}
          error={showValidation && !itemId ? 'Select an item.' : undefined}
          emptyText="No item found"
        />
        {!hasInventory ? (
          <p className="form-hint">
            No supplies have been given to you yet. The barangay office hands out stock to each health worker — get
            the latest once you have signal to check again.
          </p>
        ) : null}

        <div className="field-row">
          <FormField 
            label="Quantity"
            type="number" 
            min="1" 
            max="1000"
            value={quantity} 
            onChange={(event) => setQuantity(event.target.value)} 
            required 
            error={
              showValidation &&
              (!Number.isInteger(requestedQuantity) ||
                requestedQuantity < 1 ||
                Boolean(selectedItem && requestedQuantity > selectedItem.current_stock))
                ? selectedItem && requestedQuantity > selectedItem.current_stock
                  ? `You only have ${selectedItem.current_stock} of this left.`
                  : 'Enter a whole number, 1 or more.'
                : undefined
            }
          />
          <FormField 
            label="Date"
            type="date" 
            max={today()}
            value={disbursementDate} 
            onChange={(event) => setDisbursementDate(event.target.value)} 
            required 
            error={
              showValidation && !disbursementDate
                ? 'The date is required.'
                : showValidation && isInFuture(disbursementDate)
                  ? 'The date cannot be in the future.'
                  : undefined
            }
          />
        </div>

        <FormActions>
          <Button type="submit" disabled={saving}>
            <Icon name="save" size={18} />
            {saving ? 'Saving...' : 'Save Supply Release'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
