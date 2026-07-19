import { useState } from 'react';
import type { 
  Household, 
  Individual, 
  DwellingType, 
  ElectricService, 
  IndividualSex 
} from '../../types/database';
import { createId, today } from '../../lib/utils';
import { saveHouseholdLocally, saveIndividualLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField, SelectField } from '../common/FormField';
import { CheckboxGroup } from '../common/CheckboxGroup';
import { Icon } from '../common/Icon';
import { useBhwLanguage } from '../../app/BhwLanguageContext';

const WATER_OPTIONS = [
  { label: 'Local Water District', value: 'water_district' },
  { label: 'Deep Well', value: 'deep_well' },
  { label: 'Artesian Well', value: 'artesian_well' },
  { label: 'Bottled/Purified', value: 'bottled' },
  { label: 'Spring / River', value: 'spring_river' }
];

const TOILET_OPTIONS = [
  { label: 'Water-sealed (Flush)', value: 'water_sealed' },
  { label: 'Pit Latrine', value: 'pit_latrine' },
  { label: 'Shared / Communal', value: 'shared' },
  { label: 'None', value: 'none' }
];

const FOOD_OPTIONS = [
  { label: 'Backyard Garden', value: 'garden' },
  { label: 'Livestock / Poultry', value: 'livestock' },
  { label: 'Farming', value: 'farming' },
  { label: 'None', value: 'none' }
];

type HouseholdFormProps = {
  bhwId: string; 
  onSaved: () => Promise<void>;
};

export function HouseholdForm({ onSaved }: HouseholdFormProps) {
  const { t } = useBhwLanguage();
  const [household, setHousehold] = useState<Partial<Household>>({
    household_number: '',
    dwelling_type: 'concrete',
    electric_service: 'iselco',
    fuel_used: 'wood',
    toilet_type: [],
    water_source: [],
    food_production: [],
    health_status_notes: ''
  });

  const [members, setMembers] = useState<Partial<Individual>[]>([
    {
      first_name: '',
      middle_name: '',
      last_name: '',
      sex: 'female',
      birthday: '',
      is_household_head: true,
      is_out_of_school_youth: false,
      is_pregnant_nursing_fp: false,
    }
  ]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const missingRequirements = [
    !household.household_number?.trim() && 'household number',
    !household.water_source?.length && 'water source',
    !household.toilet_type?.length && 'toilet facility',
    !household.food_production?.length && 'food production',
    !members.every((member) => member.first_name?.trim() && member.last_name?.trim() && member.birthday) && 'member names and birthdates',
    !members.some((member) => member.is_household_head) && 'household head',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;

  function updateMember(index: number, field: keyof Individual, value: unknown) {
    const updatedMembers = [...members];
    updatedMembers[index] = { ...updatedMembers[index], [field]: value };
    setMembers(updatedMembers);
  }

  function addMember() {
    setMembers([
      ...members, 
      {
        first_name: '',
        middle_name: '',
        last_name: '',
        sex: 'female',
        birthday: '',
        is_household_head: false,
        is_out_of_school_youth: false,
        is_pregnant_nursing_fp: false,
      }
    ]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setSaving(true);
    setFormError(null);

    if (!isFormReady) {
      setSaving(false);
      return;
    }

    const hasHead = members.some((member) => member.is_household_head === true);
    if (!hasHead) {
      setFormError('Cannot save: Please assign at least one person as the Household Head.');
      setSaving(false);
      return;
    }

    if (members.length === 0) {
      setFormError('Cannot save: A household must have at least one member.');
      setSaving(false);
      return;
    }

    try {
      const householdId = createId();
      const timestamp = new Date().toISOString();

      await saveHouseholdLocally({
        ...(household as Household),
        household_id: householdId,
        created_at: timestamp,
        updated_at: timestamp,
      });

      for (const member of members) {
        await saveIndividualLocally({
          ...(member as Individual),
          resident_id: createId(),
          household_id: householdId,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }

      await onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Household profile was not saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{t('Household Profiling')}</p>
          <h2>{t('New Household Registration')}</h2>
        </div>
        <Badge label={t('Saved Offline')} tone="success" />
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        {formError ? <p className="form-alert"><Icon name="warning" size={18} />{formError}</p> : null}

        <h3>{t('Dwelling Information')}</h3>
        <FormField 
          label={t('Household Number')}
          value={household.household_number} 
          onChange={(e) => setHousehold({ ...household, household_number: e.target.value })} 
          placeholder="e.g. HH-001" 
          required 
          error={showValidation && !household.household_number?.trim() ? t('Household number is required.') : undefined}
        />
        
        <div className="field-row">
          <SelectField 
            label={t('Dwelling Type')}
            value={household.dwelling_type} 
            onChange={(e) => setHousehold({ ...household, dwelling_type: e.target.value as DwellingType })}
          >
            <option value="concrete">{t('Concrete')}</option>
            <option value="wood">{t('Wood')}</option>
            <option value="mixed">{t('Mixed')}</option>
            <option value="makeshift">{t('Makeshift')}</option>
          </SelectField>

          <SelectField 
            label={t('Electric Service')}
            value={household.electric_service} 
            onChange={(e) => setHousehold({ ...household, electric_service: e.target.value as ElectricService })}
          >
            <option value="iselco">ISELCO</option>
            <option value="lamp">Lamp</option>
            <option value="gas">Gas</option>
            <option value="none">{t('None')}</option>
          </SelectField>
        </div>

        <CheckboxGroup
          label={t('Primary Water Source(s)')}
          options={WATER_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
          selectedValues={household.water_source || []}
          onChange={(newValues) => setHousehold({ ...household, water_source: newValues })}
          error={showValidation && !household.water_source?.length ? t('Select at least one water source.') : undefined}
        />

        <CheckboxGroup
          label={t('Toilet Facility')}
          options={TOILET_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
          selectedValues={household.toilet_type || []}
          onChange={(newValues) => setHousehold({ ...household, toilet_type: newValues })}
          error={showValidation && !household.toilet_type?.length ? t('Select at least one toilet facility.') : undefined}
        />

        <CheckboxGroup
          label={t('Food Production')}
          options={FOOD_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
          selectedValues={household.food_production || []}
          onChange={(newValues) => setHousehold({ ...household, food_production: newValues })}
          error={showValidation && !household.food_production?.length ? t('Select at least one food-production option.') : undefined}
        />

        <hr style={{ margin: '2rem 0' }} />

        <h3>{t('Household Members')}</h3>
        
        {members.map((member, index) => (
          <div key={index} className="household-member-card">
            <h4>{t('Member')} {index + 1} {member.is_household_head ? `(${t('Head')})` : ''}</h4>
            
            <div className="field-row">
              <FormField 
                label={t('First Name')}
                value={member.first_name} 
                onChange={(e) => updateMember(index, 'first_name', e.target.value)} 
                required 
                error={showValidation && !member.first_name?.trim() ? t('First name is required.') : undefined}
              />
              <FormField 
                label={t('Middle Name')}
                value={member.middle_name || ''} 
                onChange={(e) => updateMember(index, 'middle_name', e.target.value)} 
                placeholder="(Optional)"
              />
              <FormField 
                label={t('Last Name')}
                value={member.last_name} 
                onChange={(e) => updateMember(index, 'last_name', e.target.value)} 
                required 
                error={showValidation && !member.last_name?.trim() ? t('Last name is required.') : undefined}
              />
            </div>

            <div className="field-row">
              <FormField 
                label={t('Birthdate')}
                type="date" 
                max={today()}
                value={member.birthday} 
                onChange={(e) => updateMember(index, 'birthday', e.target.value)} 
                required 
                error={showValidation && !member.birthday ? t('Birthdate is required.') : undefined}
              />
              <SelectField 
                label={t('Sex')}
                value={member.sex} 
                onChange={(e) => updateMember(index, 'sex', e.target.value as IndividualSex)}
              >
                <option value="female">{t('Female')}</option>
                <option value="male">{t('Male')}</option>
              </SelectField>
            </div>

            <label className={`check-option household-head-option${member.is_household_head ? ' is-selected' : ''}${showValidation && !members.some((entry) => entry.is_household_head) ? ' has-error' : ''}`}>
              <input 
                type="checkbox" 
                checked={member.is_household_head} 
                onChange={(e) => updateMember(index, 'is_household_head', e.target.checked)} 
              />
              {t('This person is a Household Head')}
            </label>
            {showValidation && !members.some((entry) => entry.is_household_head) ? <small className="field-error"><b className="required-mark">*</b> {t('Assign one household head.')}</small> : null}
          </div>
        ))}

        <Button type="button" className="add-member-button" onClick={addMember}>
          {t('+ Add Another Member')}
        </Button>

        <FormActions>
          <Button type="submit" disabled={saving}>
            <Icon name="save" size={18} />
            {t(saving ? 'Saving Offline...' : 'Save Complete Household')}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
