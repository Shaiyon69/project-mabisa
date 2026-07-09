// Goal: This component provides the UI for BHWs to register a new Household and all its constituent members at once. 
// It enforces relational data integrity and offline validation before pushing payloads to the local SQLite database.

import { useState } from 'react';
import type { 
  Household, 
  Individual, 
  DwellingType, 
  ElectricService, 
  FuelUsed, 
  IndividualSex 
} from '../../types/database';
import { createId } from '../../lib/utils';
import { saveHouseholdLocally, saveIndividualLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField, SelectField, TextAreaField } from '../common/FormField';

type HouseholdFormProps = {
  // We no longer need bhwId in the payload based on our new schema, 
  // but keeping it as a prop in case it's needed for logging later.
  bhwId: string; 
  onSaved: () => Promise<void>;
};

export function HouseholdForm({ bhwId, onSaved }: HouseholdFormProps) {
  // 1. HOUSEHOLD STATE
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

  // 2. INDIVIDUALS STATE (Array of members)
  // We initialize it with one empty member so the form isn't completely blank.
  const [members, setMembers] = useState<Partial<Individual>[]>([
    {
      first_name: '',
      last_name: '',
      sex: 'female',
      birthday: '',
      is_household_head: true, // Default the first person to head
      is_out_of_school_youth: false,
      is_pregnant_nursing_fp: false,
    }
  ]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Helper function to update a specific property of a specific member in the array
  function updateMember(index: number, field: keyof Individual, value: unknown) {
    const updatedMembers = [...members];
    updatedMembers[index] = { ...updatedMembers[index], [field]: value };
    setMembers(updatedMembers);
  }

  // Helper function to add a new blank individual to the form
  function addMember() {
    setMembers([
      ...members, 
      {
        first_name: '',
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

    // 3. STRICT OFFLINE VALIDATION
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
      // 4. GENERATE SHARED OFFLINE DATA
      const householdId = createId();
      const timestamp = new Date().toISOString();

      // 5. SAVE HOUSEHOLD FIRST
      // This ensures the foreign key exists in SQLite before we try to insert individuals
      await saveHouseholdLocally({
        ...(household as Household),
        household_id: householdId,
        created_at: timestamp,
        updated_at: timestamp,
      });

      // 6. SAVE ALL INDIVIDUALS SECOND
      // Loop through the dynamic array and link them to the householdId we just created
      for (const member of members) {
        await saveIndividualLocally({
          ...(member as Individual),
          resident_id: createId(),
          household_id: householdId,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }

      // 7. CLEANUP & CALLBACK
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
        {formError ? <p className="form-hint error">{formError}</p> : null}

        {/* --- SECTION 1: HOUSEHOLD INFO --- */}
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

        {/* Temporary comma-separated workaround for Arrays. 
            A custom CheckboxGroup component should replace this later. */}
        <FormField 
          label="Water Source (Comma separated)" 
          value={household.water_source?.join(', ')} 
          onChange={(e) => setHousehold({ ...household, water_source: e.target.value.split(',').map(s => s.trim()) })} 
          placeholder="Deepwell, Electric Pump..." 
        />

        <hr />

        {/* --- SECTION 2: INDIVIDUALS INFO --- */}
        <h3>Household Members</h3>
        
        {members.map((member, index) => (
          <div key={index} style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem', borderRadius: '8px' }}>
            <h4>Member {index + 1} {member.is_household_head ? '(Head)' : ''}</h4>
            
            <div className="field-row">
              <FormField 
                label="First Name" 
                value={member.first_name} 
                onChange={(e) => updateMember(index, 'first_name', e.target.value)} 
                required 
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

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
              <input 
                type="checkbox" 
                checked={member.is_household_head} 
                onChange={(e) => updateMember(index, 'is_household_head', e.target.checked)} 
              />
              This person is a Household Head
            </label>
          </div>
        ))}

        <Button type="button" onClick={addMember} style={{ width: 'fit-content', alignSelf: 'flex-start' }}>
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