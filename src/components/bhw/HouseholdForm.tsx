import { useState } from 'react';
import type { 
  Household, 
  Individual, 
  DwellingType, 
  ElectricService, 
  FuelUsed, 
  IndividualSex 
} from '../../types/database';
import { createId, today } from '../../lib/utils';
import { saveHouseholdLocally, saveIndividualLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField, SelectField } from '../common/FormField';
import { CheckboxGroup } from '../common/CheckboxGroup';

// Pre-defined options for the household arrays
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
    setSaving(true);
    setFormError(null);

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
          <p className="eyebrow">Household Profiling</p>
          <h2>New Household Registration</h2>
        </div>
        <Badge label="Saved Offline" tone="success" />
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        {formError ? <p className="form-hint error" style={{ color: 'red' }}>{formError}</p> : null}

        <h3>Dwelling Information</h3>
        <FormField 
          label="Household Number" 
          value={household.household_number} 
          onChange={(e) => setHousehold({ ...household, household_number: e.target.value })} 
          placeholder="e.g. HH-001" 
          required 
        />
        
        <div className="field-row">
          <SelectField 
            label="Dwelling Type" 
            value={household.dwelling_type} 
            onChange={(e) => setHousehold({ ...household, dwelling_type: e.target.value as DwellingType })}
          >
            <option value="concrete">Concrete</option>
            <option value="wood">Wood</option>
            <option value="mixed">Mixed</option>
            <option value="makeshift">Makeshift</option>
          </SelectField>

          <SelectField 
            label="Electric Service" 
            value={household.electric_service} 
            onChange={(e) => setHousehold({ ...household, electric_service: e.target.value as ElectricService })}
          >
            <option value="iselco">ISELCO</option>
            <option value="lamp">Lamp</option>
            <option value="gas">Gas</option>
            <option value="none">None</option>
          </SelectField>
        </div>

        {/* Replaced comma-separated text fields with CheckboxGroups */}
        <CheckboxGroup
          label="Primary Water Source(s)"
          options={WATER_OPTIONS}
          selectedValues={household.water_source || []}
          onChange={(newValues) => setHousehold({ ...household, water_source: newValues })}
        />

        <CheckboxGroup
          label="Toilet Facility"
          options={TOILET_OPTIONS}
          selectedValues={household.toilet_type || []}
          onChange={(newValues) => setHousehold({ ...household, toilet_type: newValues })}
        />

        <CheckboxGroup
          label="Food Production"
          options={FOOD_OPTIONS}
          selectedValues={household.food_production || []}
          onChange={(newValues) => setHousehold({ ...household, food_production: newValues })}
        />

        <hr style={{ margin: '2rem 0' }} />

        <h3>Household Members</h3>
        
        {members.map((member, index) => (
          <div key={index} style={{ border: '1px solid #e5e7eb', padding: '1rem', marginBottom: '1rem', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 1rem 0' }}>Member {index + 1} {member.is_household_head ? '(Head)' : ''}</h4>
            
            <div className="field-row">
              <FormField 
                label="First Name" 
                value={member.first_name} 
                onChange={(e) => updateMember(index, 'first_name', e.target.value)} 
                required 
              />
              <FormField 
                label="Middle Name" 
                value={member.middle_name || ''} 
                onChange={(e) => updateMember(index, 'middle_name', e.target.value)} 
                placeholder="(Optional)"
              />
              <FormField 
                label="Last Name" 
                value={member.last_name} 
                onChange={(e) => updateMember(index, 'last_name', e.target.value)} 
                required 
              />
            </div>

            <div className="field-row">
              <FormField 
                label="Birthdate" 
                type="date" 
                max={today()} // Prevents future dates
                value={member.birthday} 
                onChange={(e) => updateMember(index, 'birthday', e.target.value)} 
                required 
              />
              <SelectField 
                label="Sex" 
                value={member.sex} 
                onChange={(e) => updateMember(index, 'sex', e.target.value as IndividualSex)}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
              </SelectField>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '1rem', cursor: 'pointer', fontSize: '0.875rem' }}>
              <input 
                type="checkbox" 
                checked={member.is_household_head} 
                onChange={(e) => updateMember(index, 'is_household_head', e.target.checked)} 
              />
              This person is a Household Head
            </label>
          </div>
        ))}

        <Button type="button" onClick={addMember} style={{ width: 'fit-content', alignSelf: 'flex-start', marginTop: '0.5rem' }}>
          + Add Another Member
        </Button>

        <FormActions>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving Offline...' : 'Save Complete Household'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}