import { useState } from 'react';
import type { Household, Individual } from '../../types/database';
import { createId, scrollToFirstError } from '../../lib/utils';
import { findLikelyDuplicates } from '../../lib/duplicates';
import { readLocalIndividuals, saveHouseholdLocally, saveIndividualLocally } from '../../services/localDatabase';
import { DuplicateWarningModal, type FlaggedMember } from './DuplicateWarningModal';
import { MemberChoice, MemberFields } from './MemberFields';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField } from '../common/FormField';
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

type HouseholdFormProps = {
  bhwId: string;
  onSaved: () => Promise<void>;
};

export function HouseholdForm({ bhwId, onSaved }: HouseholdFormProps) {
  const { t } = useBhwLanguage();
  const [household, setHousehold] = useState<Partial<Household>>({
    household_number: '',
    // Housing type, electric service and fuel are not health data and are not
    // asked here. They are still `not null` on the SQLite mirror and the central
    // table, so a placeholder rides along to satisfy the constraint; a device
    // installed before any column drop keeps its own schema either way.
    // TODO: drop the three columns in a migration once the live database can
    // take it, and remove these placeholders with them.
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
  const [showValidation, setShowValidation] = useState(false);
  // Members that look like someone already on this device, and the reason the BHW
  // gives for saving them anyway. Non-empty `flagged` is what holds the save: the
  // warning is raised before anything is written, never after.
  const [flagged, setFlagged] = useState<FlaggedMember[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
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
        occupation: '',
        educational_attainment: '',
        is_out_of_school_youth: false,
        is_pregnant_nursing_fp: false,
        philhealth_number: '',
      }
    ]);
  }

  /**
   * Members who look like a record already on this device, checked before a single
   * row is written.
   *
   * Candidates come from the same search the resident picker uses rather than a
   * query of its own, so a name that can be found here is a name that could be
   * found there. Only local SQLite is consulted: a resident profiled by a BHW in
   * another purok is not on this device and RLS will not put them there, so
   * cross-purok duplicates are the admin portal's to catch.
   */
  async function scanForDuplicates(): Promise<FlaggedMember[]> {
    const scans = await Promise.all(
      members.map(async (member, index) => {
        const candidates = await readLocalIndividuals({ searchQuery: member.last_name?.trim(), limit: 50 });
        const matches = findLikelyDuplicates(
          {
            first_name: member.first_name ?? '',
            last_name: member.last_name ?? '',
            birthday: member.birthday ?? '',
          },
          candidates,
        );

        return {
          memberNumber: index + 1,
          memberName: `${member.first_name} ${member.last_name}`.trim(),
          matches,
        };
      }),
    );

    return scans.filter((member) => member.matches.length > 0);
  }

  /**
   * Writes the household and every member.
   *
   * `overriddenMembers` is empty on the clean path and carries the flagged members
   * when the BHW has said they are different people — each of those gets the
   * record they were shown, their reason, and their own account stamped on it.
   */
  async function persistHousehold(overriddenMembers: FlaggedMember[], reason: string): Promise<void> {
    const householdId = createId();
    const timestamp = new Date().toISOString();
    const overrideByMemberNumber = new Map(overriddenMembers.map((member) => [member.memberNumber, member]));

    await saveHouseholdLocally({
      ...(household as Household),
      household_id: householdId,
      created_at: timestamp,
      updated_at: timestamp,
    });

    for (const [index, member] of members.entries()) {
      // Sorted most convincing first, so the head of the list is the record the
      // BHW was actually weighing this person against.
      const overridden = overrideByMemberNumber.get(index + 1);

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
        updated_by: bhwId,
        duplicate_override_of: overridden?.matches[0]?.person.resident_id ?? null,
        duplicate_override_reason: overridden ? reason.trim() : null,
        duplicate_override_by: overridden ? bhwId : null,
        duplicate_override_at: overridden ? timestamp : null,
      });
    }

    await onSaved();
  }

  async function handleOverride() {
    setSaving(true);
    setFormError(null);

    try {
      await persistHousehold(flagged, overrideReason);
      setFlagged([]);
      setOverrideReason('');
    } catch (error) {
      setFlagged([]);
      setFormError(error instanceof Error ? error.message : 'Household profile was not saved.');
      scrollToFirstError();
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setSaving(true);
    setFormError(null);

    // Every rejection ends the same way: stop saving, then put the reason on
    // screen. The form is taller than the phone, so leaving that to the render
    // alone would show the person nothing.
    function reject(reason: string | null) {
      setFormError(reason);
      setSaving(false);
      scrollToFirstError();
    }

    if (!isFormReady) {
      reject(null);
      return;
    }

    const hasHead = members.some((member) => member.is_household_head === true);
    if (!hasHead) {
      reject('Cannot save: Please assign at least one person as the Household Head.');
      return;
    }

    if (members.length === 0) {
      reject('Cannot save: A household must have at least one member.');
      return;
    }

    // Length is left unchecked on purpose — a partially remembered ID is still
    // worth recording, and blocking a whole household over it helps nobody.
    const badPhilhealth = members.findIndex(
      (member) => member.philhealth_number?.trim() && !PHILHEALTH_ALLOWED.test(member.philhealth_number.trim()),
    );

    if (badPhilhealth !== -1) {
      reject(
        `Cannot save: Member ${badPhilhealth + 1}'s PhilHealth number may only contain digits, spaces, and dashes.`,
      );
      return;
    }

    try {
      // The warning comes before the write, not after it. A save that had already
      // landed would leave the BHW deleting a record they were never offered the
      // chance to decline.
      const flaggedMembers = await scanForDuplicates();

      if (flaggedMembers.length > 0) {
        setFlagged(flaggedMembers);
        setSaving(false);
        return;
      }

      await persistHousehold([], '');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Household profile was not saved.');
      scrollToFirstError();
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
        {formError ? <p className="form-alert" role="alert"><Icon name="warning" size={18} />{formError}</p> : null}

        <h3>{t('Household Information')}</h3>
        <FormField 
          label={t('Household Number')}
          value={household.household_number} 
          onChange={(e) => setHousehold({ ...household, household_number: e.target.value })} 
          placeholder="e.g. HH-001" 
          required 
          error={showValidation && !household.household_number?.trim() ? t('Household number is required.') : undefined}
        />

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

        <hr className="form-divider" />

        <h3>{t('Household Members')}</h3>

        {members.map((member, index) => (
          <div key={index} className="member-card">
            <h4>{t('Member')} {index + 1} {member.is_household_head ? `(${t('Head')})` : ''}</h4>

            <MemberFields
              member={member}
              showValidation={showValidation}
              onChange={(field, value) => updateMember(index, field, value)}
            >
              <MemberChoice
                label={t('This person is a household head')}
                checked={member.is_household_head ?? false}
                onChange={(next) => updateMember(index, 'is_household_head', next)}
              />
            </MemberFields>

            {showValidation && !members.some((entry) => entry.is_household_head) ? <small className="field-error"><b className="required-mark">*</b> {t('Assign one household head.')}</small> : null}
          </div>
        ))}

        <Button type="button" variant="ghost" className="add-member-action" onClick={addMember}>
          {t('Add another member')}
        </Button>

        <FormActions>
          <Button type="submit" disabled={saving}>
            <Icon name="save" size={18} />
            {t(saving ? 'Saving Offline...' : 'Save Complete Household')}
          </Button>
        </FormActions>
      </form>

      <DuplicateWarningModal
        open={flagged.length > 0}
        flagged={flagged}
        reason={overrideReason}
        saving={saving}
        onReasonChange={setOverrideReason}
        onCancel={() => {
          setFlagged([]);
          setOverrideReason('');
        }}
        onOverride={() => void handleOverride()}
      />
    </Card>
  );
}
