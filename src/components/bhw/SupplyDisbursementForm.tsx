import { useRef, useState } from 'react';
import type { InventoryItem, SupplyDisbursement } from '../../types/database'; 
import { createId, ignoreImplicitSubmit, isInFuture, scrollToFirstError, today } from '../../lib/utils';
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
  const [itemId, setItemId] = useState(inventoryItems[0]?.item_id || '');
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
    !hasIndividuals && 'registered resident',
    !residentId && 'selected resident',
    !hasInventory && 'available inventory',
    !itemId && 'selected item',
    (!requestedQuantity || requestedQuantity < 1) && 'valid quantity',
    selectedItem && requestedQuantity > selectedItem.current_stock && 'quantity within available stock',
    !disbursementDate && 'disbursement date',
    isInFuture(disbursementDate) && 'a disbursement date on or before today',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;
  // Minted once and held until the row lands, so a retry after a failed write
  // updates the same release instead of decrementing stock a second time.
  const pendingId = useRef<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setFormError(null);
    
    if (!isFormReady) {
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
      setFormError(error instanceof Error ? error.message : 'Supply disbursement was not saved.');
      scrollToFirstError();
      setSaving(false);
      return;
    }

    // The release is recorded and the stock already decremented. Nothing below
    // may report it as unsaved — a retry would take the quantity twice.
    pendingId.current = null;
    setResidentId('');
    setQuantity('1');
    setSaving(false);

    try {
      await onSaved();
    } catch {
      setFormError('Release was recorded. The screen could not be refreshed — it is on the queue either way.');
    }
  }

  return (
    <Card className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Inventory</p>
          <h2>Disburse Supplies</h2>
        </div>
        <div className="header-actions">
          <Badge label={hasIndividuals ? 'Residents Ready' : 'Needs Profile'} tone={hasIndividuals ? 'success' : 'warning'} />
          <Badge label={hasInventory ? 'Stock Available' : 'Empty Stock'} tone={hasInventory ? 'success' : 'danger'} />
        </div>
      </div>

      <form className="stack" onSubmit={handleSubmit} onKeyDown={ignoreImplicitSubmit} noValidate>
        {formError ? <p className="form-alert" role="alert"><Icon name="warning" size={18} />{formError}</p> : null}

        <IndividualSearch selectedResidentId={residentId} onChange={setResidentId} error={showValidation && !residentId ? 'Select a resident.' : undefined} />
        {!hasIndividuals ? <p className="form-hint">Register a household before disbursing supplies.</p> : null}

        <Combobox
          label="Item"
          value={itemId}
          options={inventoryItems.map((item) => ({
            value: item.item_id,
            label: `${item.item_name} (${item.current_stock} in stock)`,
          }))}
          onChange={setItemId}
          placeholder="Search item..."
          disabled={!hasInventory}
          error={showValidation && !itemId ? 'Select an inventory item.' : undefined}
          emptyText="No item found"
        />
        {!hasInventory ? <p className="form-hint">Admin must sync inventory items before disbursement.</p> : null}

        <div className="field-row">
          <FormField 
            label="Quantity"
            type="number" 
            min="1" 
            max="1000"
            value={quantity} 
            onChange={(event) => setQuantity(event.target.value)} 
            required 
            error={showValidation && (!requestedQuantity || requestedQuantity < 1 || Boolean(selectedItem && requestedQuantity > selectedItem.current_stock)) ? selectedItem && requestedQuantity > selectedItem.current_stock ? `Only ${selectedItem.current_stock} item(s) are available.` : 'Enter a quantity of at least 1.' : undefined}
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
                ? 'Disbursement date is required.'
                : showValidation && isInFuture(disbursementDate)
                  ? 'Disbursement date cannot be in the future.'
                  : undefined
            }
          />
        </div>

        <FormActions>
          <Button type="submit" disabled={saving}>
            <Icon name="save" size={18} />
            {saving ? 'Saving Offline...' : 'Save Disbursement'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
