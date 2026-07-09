import { useMemo, useState } from 'react';
import type { InventoryItem, Individual, SupplyDisbursement } from '../../types/database';
import { createId, titleCase, today } from '../../lib/utils';
import { saveInventoryItemLocally, saveSupplyDisbursementLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField, SelectField } from '../common/FormField';
import { IndividualSearch } from './IndividualSearch'; // Updated import

type SupplyDisbursementFormProps = {
  individuals: Individual[]; // Updated from residents
  inventoryItems: InventoryItem[];
  onSaved: () => Promise<void>;
};

export function SupplyDisbursementForm({ individuals, inventoryItems, onSaved }: SupplyDisbursementFormProps) {
  const [residentId, setResidentId] = useState('');
  const [itemId, setItemId] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [disbursementDate, setDisbursementDate] = useState(today());
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  // Fallback to the first individual if none is selected
  const selectedResidentId = residentId || individuals[0]?.resident_id || '';
  const selectedItemId = itemId || inventoryItems[0]?.item_id || '';
  const selectedItem = inventoryItems.find((item) => item.item_id === selectedItemId) ?? null;
  
  const filteredInventoryItems = useMemo(() => {
    const search = itemSearch.trim().toLowerCase();

    if (!search) {
      return inventoryItems;
    }

    return inventoryItems.filter((item) => `${item.item_name} ${item.type}`.toLowerCase().includes(search));
  }, [inventoryItems, itemSearch]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedItem) {
      return;
    }

    const releasedQuantity = Number(quantity);
    if (releasedQuantity <= 0 || releasedQuantity > selectedItem.current_stock) {
      return;
    }

    setSaving(true);
    setFormError(null);
    const timestamp = new Date().toISOString();
    
    // Note: resident_id remains the same to maintain the database foreign key link
    const disbursement: SupplyDisbursement = {
      log_id: createId(),
      item_id: selectedItemId,
      resident_id: selectedResidentId, 
      disbursement_date: disbursementDate,
      quantity: releasedQuantity,
      created_at: timestamp,
      updated_at: timestamp,
    };
    
    const updatedItem: InventoryItem = {
      ...selectedItem,
      current_stock: selectedItem.current_stock - releasedQuantity,
      updated_at: timestamp,
    };

    try {
      await saveSupplyDisbursementLocally(disbursement);
      await saveInventoryItemLocally(updatedItem, 'UPDATE');
      setQuantity('');
      setDisbursementDate(today());
      await onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Supply disbursement was not saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Supply allocation</p>
          <h2>Log Supply Disbursement</h2>
        </div>
        <Badge
          label={!individuals.length ? 'Needs Profile' : !inventoryItems.length ? 'Needs Inventory' : 'Ready'}
          tone={individuals.length && inventoryItems.length ? 'success' : 'warning'}
        />
      </div>
      <form className="stack" onSubmit={handleSubmit}>
        {formError ? <p className="form-hint">{formError}</p> : null}
        
        {/* Swapped to IndividualSearch and passed the new array */}
        <IndividualSearch individuals={individuals} selectedResidentId={selectedResidentId} onChange={setResidentId} />
        
        <FormField
          label="Search Supply Item"
          value={itemSearch}
          onChange={(event) => setItemSearch(event.target.value)}
          placeholder="Search by item name or type"
          disabled={!inventoryItems.length}
        />
        <SelectField label="Supply Item" value={selectedItemId} onChange={(event) => setItemId(event.target.value)} required disabled={!inventoryItems.length}>
          {filteredInventoryItems.map((item) => (
            <option key={item.item_id} value={item.item_id}>
              {item.item_name} • {titleCase(item.type)} • {item.current_stock} left
            </option>
          ))}
        </SelectField>
        <div className="field-row">
          <FormField label="Date Released" type="date" value={disbursementDate} onChange={(event) => setDisbursementDate(event.target.value)} required />
          <FormField
            label="Quantity"
            min="1"
            max={selectedItem?.current_stock ?? 1}
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
        </div>
        <div className="stock-card">
          <span>Available stock</span>
          <strong>{selectedItem?.current_stock ?? 0}</strong>
          <small>{selectedItem ? titleCase(selectedItem.type) : 'Select an inventory item'}</small>
        </div>
        <FormActions>
          <Button type="submit" disabled={saving || !individuals.length || !inventoryItems.length}>
            {saving ? 'Saving Offline...' : 'Save Disbursement'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}