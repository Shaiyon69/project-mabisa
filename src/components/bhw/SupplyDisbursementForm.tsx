import { useState } from 'react';
import type { InventoryItem, SupplyDisbursement } from '../../types/database'; 
import { createId, today } from '../../lib/utils';
import { saveSupplyDisbursementLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField, SelectField } from '../common/FormField';
import { IndividualSearch } from './IndividualSearch';

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

  const hasIndividuals = individualCount > 0;
  const hasInventory = inventoryItems.length > 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    
    if (!residentId || !itemId) {
      setFormError('Please select both a resident and an inventory item.');
      return;
    }

    setSaving(true);
    setFormError(null);
    const timestamp = new Date().toISOString();

    const disbursement: SupplyDisbursement = {
      log_id: createId(),
      resident_id: residentId,
      item_id: itemId,
      quantity: Number(quantity),
      disbursement_date: disbursementDate,
      created_at: timestamp,
      updated_at: timestamp,
    };

    try {
      await saveSupplyDisbursementLocally(disbursement);
      setResidentId('');
      setQuantity('1');
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
          <p className="eyebrow">Inventory</p>
          <h2>Disburse Supplies</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Badge label={hasIndividuals ? 'Residents Ready' : 'Needs Profile'} tone={hasIndividuals ? 'success' : 'warning'} />
          <Badge label={hasInventory ? 'Stock Available' : 'Empty Stock'} tone={hasInventory ? 'success' : 'danger'} />
        </div>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        {formError ? <p className="form-hint" style={{ color: 'red' }}>{formError}</p> : null}

        <IndividualSearch selectedResidentId={residentId} onChange={setResidentId} />
        {!hasIndividuals ? <p className="form-hint">Register a household before disbursing supplies.</p> : null}

        <SelectField 
          label="Item" 
          value={itemId} 
          onChange={(event) => setItemId(event.target.value)} 
          required
          disabled={!hasInventory}
        >
          {inventoryItems.map((item) => (
            <option key={item.item_id} value={item.item_id}>
              {item.item_name} ({item.current_stock} in stock)
            </option>
          ))}
        </SelectField>
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
          />
          <FormField 
            label="Date" 
            type="date" 
            max={today()}
            value={disbursementDate} 
            onChange={(event) => setDisbursementDate(event.target.value)} 
            required 
          />
        </div>

        <FormActions>
          <Button type="submit" disabled={saving || !hasIndividuals || !hasInventory || !residentId}>
            {saving ? 'Saving Offline...' : 'Save Disbursement'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
