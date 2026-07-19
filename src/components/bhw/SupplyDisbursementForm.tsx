import { useState } from 'react';
import type { InventoryItem, SupplyDisbursement } from '../../types/database'; 
import { createId, today } from '../../lib/utils';
import { saveSupplyDisbursementLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField, SelectField } from '../common/FormField';
import { IndividualSearch } from './IndividualSearch';
import { Icon } from '../common/Icon';
import { useBhwLanguage } from '../../app/BhwLanguageContext';

type SupplyDisbursementFormProps = {
  individualCount: number; 
  inventoryItems: InventoryItem[];
  onSaved: () => Promise<void>;
};

export function SupplyDisbursementForm({ individualCount, inventoryItems, onSaved }: SupplyDisbursementFormProps) {
  const { t, isFilipino } = useBhwLanguage();
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
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setFormError(null);
    
    if (!isFormReady) {
      return;
    }

    setSaving(true);
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
          <p className="eyebrow">{t('Inventory')}</p>
          <h2>{t('Disburse Supplies')}</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Badge label={t(hasIndividuals ? 'Residents Ready' : 'Needs Profile')} tone={hasIndividuals ? 'success' : 'warning'} />
          <Badge label={t(hasInventory ? 'Stock Available' : 'Empty Stock')} tone={hasInventory ? 'success' : 'danger'} />
        </div>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        {formError ? <p className="form-alert"><Icon name="warning" size={18} />{formError}</p> : null}

        <IndividualSearch selectedResidentId={residentId} onChange={setResidentId} error={showValidation && !residentId ? t('Select a resident.') : undefined} />
        {!hasIndividuals ? <p className="form-hint">{t('Register a household before disbursing supplies.')}</p> : null}

        <SelectField 
          label={t('Item')}
          value={itemId} 
          onChange={(event) => setItemId(event.target.value)} 
          required
          disabled={!hasInventory}
          error={showValidation && !itemId ? t('Select an inventory item.') : undefined}
        >
          {inventoryItems.map((item) => (
            <option key={item.item_id} value={item.item_id}>
              {item.item_name} ({item.current_stock} in stock)
            </option>
          ))}
        </SelectField>
        {!hasInventory ? <p className="form-hint">{t('Admin must sync inventory items before disbursement.')}</p> : null}

        <div className="field-row">
          <FormField 
            label={t('Quantity')}
            type="number" 
            min="1" 
            max="1000"
            value={quantity} 
            onChange={(event) => setQuantity(event.target.value)} 
            required 
            error={showValidation && (!requestedQuantity || requestedQuantity < 1 || Boolean(selectedItem && requestedQuantity > selectedItem.current_stock)) ? selectedItem && requestedQuantity > selectedItem.current_stock ? isFilipino ? `${selectedItem.current_stock} aytem lamang ang available.` : `Only ${selectedItem.current_stock} item(s) are available.` : t('Enter a quantity of at least 1.') : undefined}
          />
          <FormField 
            label={t('Date')}
            type="date" 
            max={today()}
            value={disbursementDate} 
            onChange={(event) => setDisbursementDate(event.target.value)} 
            required 
            error={showValidation && !disbursementDate ? t('Disbursement date is required.') : undefined}
          />
        </div>

        <FormActions>
          <Button type="submit" disabled={saving}>
            <Icon name="save" size={18} />
            {t(saving ? 'Saving Offline...' : 'Save Disbursement')}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
