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

// The column is plain text with no check constraint, so a fixed list is safe here
// and keeps the registry searchable in a way free text would not.
const EDUCATION_OPTIONS = [
  { label: '(Not specified)', value: '' },
  { label: 'None', value: 'none' },
  { label: 'Elementary', value: 'elementary' },
  { label: 'High School', value: 'high_school' },
  { label: 'Senior High School', value: 'senior_high' },
  { label: 'Vocational', value: 'vocational' },
  { label: 'College', value: 'college' },
  { label: 'Post-graduate', value: 'post_graduate' }
];

// PhilHealth numbers get written with dashes or spaces on paper forms. Accept both
// on input, reject anything that is clearly not a number, and store digits only so
// the same person cannot end up under two spellings of one ID.
const PHILHEALTH_ALLOWED = /^[\d\s-]+$/;

/** Blank optional text is stored as NULL rather than an empty string. */
function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Strips the formatting a BHW typed, leaving the canonical digits. */
function philhealthDigits(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, '');
  return digits ? digits : null;
}

/** One per-member yes/no, on the same target as every other choice in the app. */
function MemberChoice({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`choice${checked ? ' is-checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

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
      occupation: '',
      educational_attainment: '',
      is_out_of_school_youth: false,
      is_pregnant_nursing_fp: false,
      philhealth_number: '',
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
        occupation: '',
        educational_attainment: '',
        is_out_of_school_youth: false,
        is_pregnant_nursing_fp: false,
        philhealth_number: '',
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

    // Length is left unchecked on purpose — a partially remembered ID is still
    // worth recording, and blocking a whole household over it helps nobody.
    const badPhilhealth = members.findIndex(
      (member) => member.philhealth_number?.trim() && !PHILHEALTH_ALLOWED.test(member.philhealth_number.trim()),
    );

    if (badPhilhealth !== -1) {
      setFormError(
        `Cannot save: Member ${badPhilhealth + 1}'s PhilHealth number may only contain digits, spaces, and dashes.`,
      );
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
          // Optional text is normalised here so the column holds NULL rather than
          // an empty string, which reads the same in the UI but not in a query.
          occupation: emptyToNull(member.occupation),
          educational_attainment: emptyToNull(member.educational_attainment),
          philhealth_number: philhealthDigits(member.philhealth_number),
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
        {formError ? <p className="alert" role="alert">{formError}</p> : null}

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

        <hr className="form-divider" />

        <h3>Household Members</h3>

        {members.map((member, index) => (
          <div key={index} className="member-card">
            <h4>Member {index + 1} {member.is_household_head ? '(Head)' : ''}</h4>

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

            <div className="field-row">
              <FormField
                label="Occupation"
                value={member.occupation || ''}
                onChange={(e) => updateMember(index, 'occupation', e.target.value)}
                placeholder="(Optional)"
              />
              <SelectField
                label="Educational Attainment"
                value={member.educational_attainment || ''}
                onChange={(e) => updateMember(index, 'educational_attainment', e.target.value)}
              >
                {EDUCATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </div>

            <FormField
              label="PhilHealth Number"
              value={member.philhealth_number || ''}
              onChange={(e) => updateMember(index, 'philhealth_number', e.target.value)}
              placeholder="(Optional) e.g. 12-345678901-2"
              inputMode="numeric"
              hint="Dashes and spaces are fine — only the digits are saved."
            />

            <div className="choice-list">
              <MemberChoice
                label="This person is a household head"
                checked={member.is_household_head ?? false}
                onChange={(next) => updateMember(index, 'is_household_head', next)}
              />
              <MemberChoice
                label="Out-of-school youth"
                checked={member.is_out_of_school_youth ?? false}
                onChange={(next) => updateMember(index, 'is_out_of_school_youth', next)}
              />
              <MemberChoice
                label="Pregnant, nursing, or using family planning"
                checked={member.is_pregnant_nursing_fp ?? false}
                onChange={(next) => updateMember(index, 'is_pregnant_nursing_fp', next)}
              />
            </div>
          </div>
        ))}

        <Button type="button" variant="ghost" className="add-member-action" onClick={addMember}>
          Add another member
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