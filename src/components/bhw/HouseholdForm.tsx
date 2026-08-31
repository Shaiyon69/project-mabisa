import { useEffect, useRef, useState } from 'react';
import type { Household, Individual } from '../../types/database';
import { createId, emptyToNull, ignoreImplicitSubmit, isInFuture, philhealthDigits, scrollToFirstError } from '../../lib/utils';
import { findLikelyDuplicates } from '../../lib/duplicates';
import {
  findLocalHouseholdByNumber,
  readLocalIndividuals,
  saveHouseholdLocally,
  saveIndividualLocally,
} from '../../services/localDatabase';
import { DuplicateWarningModal, type FlaggedMember } from './DuplicateWarningModal';
import { MemberChoice, MemberFields } from './MemberFields';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField } from '../common/FormField';
import { CheckboxGroup } from '../common/CheckboxGroup';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';

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

// Accepts dashes/spaces on input (as written on paper forms); digits-only storage prevents two spellings of one ID.
const PHILHEALTH_ALLOWED = /^[\d\s-]+$/;

/**
 * A household is minutes of typing on a phone that also rings, sleeps and runs out
 * of battery. The form keeps the entries in local storage as they are typed and
 * offers them back on the next visit, so a backgrounded tab is an interruption
 * rather than a re-survey. Keyed per health worker: two accounts on one device must
 * not inherit each other's half-finished household.
 */
type HouseholdDraft = {
  household: Partial<Household>;
  members: Partial<Individual>[];
  savedAt: string;
};

function draftKey(bhwId: string): string {
  return `mabisa.household_draft.${bhwId}`;
}

function readDraft(bhwId: string): HouseholdDraft | null {
  try {
    const stored = localStorage.getItem(draftKey(bhwId));
    const parsed = stored ? (JSON.parse(stored) as HouseholdDraft) : null;

    // A draft with no members is a shape this form cannot render — treat it as none.
    return parsed?.members?.length ? parsed : null;
  } catch {
    return null;
  }
}

function writeDraft(bhwId: string, draft: HouseholdDraft): void {
  try {
    localStorage.setItem(draftKey(bhwId), JSON.stringify(draft));
  } catch {
    // Storage full or unavailable — the form still works, it just cannot be resumed.
  }
}

function clearDraft(bhwId: string): void {
  try {
    localStorage.removeItem(draftKey(bhwId));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/** An empty household and an empty member row. Written once — the form starts, resets and grows rows from the same shape. */
function blankHousehold(): Partial<Household> {
  return {
    household_number: '',
    toilet_type: [],
    water_source: [],
    food_production: [],
    health_status_notes: '',
  };
}

function blankMember(isHead: boolean): Partial<Individual> {
  return {
    first_name: '',
    middle_name: '',
    last_name: '',
    sex: 'female',
    birthday: '',
    is_household_head: isHead,
    relationship_to_head: null,
    occupation: '',
    educational_attainment: '',
    is_out_of_school_youth: false,
    is_pregnant_nursing_fp: false,
    philhealth_number: '',
  };
}

type HouseholdFormProps = {
  bhwId: string;
  onSaved: () => Promise<void>;
};

export function HouseholdForm({ bhwId, onSaved }: HouseholdFormProps) {
  // Read once, on the first render only — later renders must not fight the BHW's typing.
  const [restored] = useState(() => readDraft(bhwId));
  const [restoredNotice, setRestoredNotice] = useState(restored !== null);
  const [household, setHousehold] = useState<Partial<Household>>(restored?.household ?? blankHousehold());
  const [members, setMembers] = useState<Partial<Individual>[]>(restored?.members ?? [blankMember(true)]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  // Members that look like an existing record, plus the BHW's reason for saving anyway.
  // Non-empty `flagged` holds the save — the warning is raised before anything is written.
  const [flagged, setFlagged] = useState<FlaggedMember[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  // The household already recorded under the number being typed. Offered, never
  // forced — the BHW decides whether this is the same house.
  const [existingMatch, setExistingMatch] = useState<Household | null>(null);
  // Index of the member the BHW asked to remove, held until they confirm. Only a
  // row with something typed in it gets that question — an empty one just goes.
  const [removingMember, setRemovingMember] = useState<number | null>(null);
  // The pending draft write, so a save can cancel one that is still armed.
  const draftTimer = useRef<number | undefined>(undefined);
  // A form carrying a household id is editing that household, not creating one.
  const isRevisit = Boolean(household.household_id);
  const missingRequirements = [
    !household.household_number?.trim() && 'household number',
    !household.water_source?.length && 'water source',
    !household.toilet_type?.length && 'toilet facility',
    !household.food_production?.length && 'food production',
    !members.every((member) => member.first_name?.trim() && member.last_name?.trim() && member.birthday) && 'member names and birthdates',
    !members.some((member) => member.is_household_head) && 'household head',
    members.some((member) => isInFuture(member.birthday)) && 'birthdates on or before today',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;

  // Nothing typed yet is not a draft — an untouched form would otherwise offer
  // itself back as one on the next visit.
  const hasEntries =
    Boolean(household.household_number?.trim()) ||
    Boolean(household.health_status_notes?.trim()) ||
    Boolean(household.toilet_type?.length) ||
    Boolean(household.water_source?.length) ||
    Boolean(household.food_production?.length) ||
    members.some((member) => memberHasEntries(member));

  // Debounced: `household` and `members` are new objects on every change, so
  // without the timer this serialized the whole household and every member to
  // local storage on each keystroke — a synchronous write in the middle of
  // typing, on the cheap phone this is actually used on. The worst a crash now
  // costs is the last half-second of typing.
  useEffect(() => {
    if (!hasEntries) {
      return;
    }

    draftTimer.current = window.setTimeout(() => {
      writeDraft(bhwId, { household, members, savedAt: new Date().toISOString() });
    }, 500);

    return () => window.clearTimeout(draftTimer.current);
  }, [bhwId, hasEntries, household, members]);

  /**
   * Discards the draft for good. The pending write is cancelled first: a BHW who
   * taps Save within the debounce window still has a timer armed, and letting it
   * fire would put the draft back after the household was written — offering a
   * saved household back as unfinished work on the next visit.
   */
  function discardDraft() {
    window.clearTimeout(draftTimer.current);
    clearDraft(bhwId);
  }

  function startBlank() {
    discardDraft();
    setHousehold(blankHousehold());
    setMembers([blankMember(true)]);
    setFlagged([]);
    setShowValidation(false);
    setRestoredNotice(false);
    setExistingMatch(null);
  }

  /** Looks for an existing record under the number just typed, so a re-visit is offered before it is retyped. */
  async function checkForExisting() {
    try {
      const existing = await findLocalHouseholdByNumber(household.household_number);

      // The household this form is already editing is not a match to offer.
      setExistingMatch(existing && existing.household_id !== household.household_id ? existing : null);
    } catch {
      // A failed lookup must not block entry — the submit check runs it again.
    }
  }

  /** Loads a recorded household and its members into this form, turning it into an update. */
  async function openExisting(existing: Household) {
    const existingMembers = await readLocalIndividuals({ householdId: existing.household_id });

    setHousehold(existing);
    // Head first, matching how the form is filled in on paper; the read is ordered by name.
    setMembers(
      existingMembers.length
        ? [...existingMembers].sort((left, right) => Number(right.is_household_head) - Number(left.is_household_head))
        : members,
    );
    setExistingMatch(null);
    setFlagged([]);
    setShowValidation(false);
    setFormError(null);
    setRestoredNotice(false);
  }

  function updateMember(index: number, field: keyof Individual, value: unknown) {
    const updatedMembers = [...members];
    updatedMembers[index] = { ...updatedMembers[index], [field]: value };
    setMembers(updatedMembers);
  }

  function addMember() {
    setMembers([...members, blankMember(false)]);
  }

  function memberLabel(member: Partial<Individual>, index: number): string {
    const name = `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim();

    return name || `Member ${index + 1}`;
  }

  /** Whether anything was typed into this row — an untouched one is not worth a confirmation. */
  function memberHasEntries(member: Partial<Individual>): boolean {
    return Boolean(
      member.first_name?.trim() ||
        member.middle_name?.trim() ||
        member.last_name?.trim() ||
        member.birthday ||
        member.occupation?.trim() ||
        member.educational_attainment?.trim() ||
        member.philhealth_number?.trim(),
    );
  }

  function requestRemoveMember(index: number) {
    if (memberHasEntries(members[index])) {
      setRemovingMember(index);
      return;
    }

    removeMember(index);
  }

  function removeMember(index: number) {
    setMembers(members.filter((_, position) => position !== index));
    setRemovingMember(null);
    // Duplicate flags are keyed by member number, which every later row just changed.
    setFlagged([]);
  }

  /**
   * Members who look like an existing record, checked before anything is written.
   * Only local SQLite is consulted — a resident in another purok isn't on this
   * device, so cross-purok duplicates are the admin portal's to catch.
   */
  async function scanForDuplicates(): Promise<FlaggedMember[]> {
    const scans = await Promise.all(
      members.map(async (member, index) => {
        // Former members included: someone who moved out and came back is exactly
        // the person this warning exists to catch before she is entered twice.
        const candidates = (await readLocalIndividuals({ searchQuery: member.last_name?.trim(), limit: 50, includeFormer: true }))
          // On a re-visit every member already on file matches themselves; only
          // people outside this household are a duplicate worth raising.
          .filter((candidate) => !household.household_id || candidate.household_id !== household.household_id);
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
   * Writes the household and every member. `overriddenMembers` carries the
   * flagged members once the BHW confirms they're different people — each gets
   * the record they were shown, the reason, and who confirmed it stamped on.
   */
  async function persistHousehold(overriddenMembers: FlaggedMember[], reason: string): Promise<void> {
    // A re-visit keeps the ids it was opened with, so the same house is updated
    // rather than recorded twice. New members inside it are still inserts.
    const householdId = household.household_id ?? createId();
    const timestamp = new Date().toISOString();
    const overrideByMemberNumber = new Map(overriddenMembers.map((member) => [member.memberNumber, member]));

    await saveHouseholdLocally(
      {
        ...(household as Household),
        household_id: householdId,
        created_at: household.created_at ?? timestamp,
        updated_at: timestamp,
      },
      isRevisit ? 'UPDATE' : 'INSERT',
    );

    for (const [index, member] of members.entries()) {
      // Sorted most convincing first, so the head of the list is the record the
      // BHW was actually weighing this person against.
      const overridden = overrideByMemberNumber.get(index + 1);

      await saveIndividualLocally(
        {
          ...(member as Individual),
          resident_id: member.resident_id ?? createId(),
          household_id: householdId,
          // Optional text is normalised here so the column holds NULL rather than
          // an empty string, which reads the same in the UI but not in a query.
          occupation: emptyToNull(member.occupation),
          educational_attainment: emptyToNull(member.educational_attainment),
          philhealth_number: philhealthDigits(member.philhealth_number),
          // Stripped here, not when the head box is ticked, so ticking and unticking keeps the answer already given.
          relationship_to_head: member.is_household_head ? null : member.relationship_to_head ?? null,
          created_at: member.created_at ?? timestamp,
          updated_at: timestamp,
          updated_by: bhwId,
          // Falls back to what the member already carries: a re-visit that raises no
          // new warning must not erase an override recorded on an earlier visit.
          duplicate_override_of: overridden?.matches[0]?.person.resident_id ?? member.duplicate_override_of ?? null,
          duplicate_override_reason: overridden ? reason.trim() : member.duplicate_override_reason ?? null,
          duplicate_override_by: overridden ? bhwId : member.duplicate_override_by ?? null,
          duplicate_override_at: overridden ? timestamp : member.duplicate_override_at ?? null,
        },
        member.resident_id ? 'UPDATE' : 'INSERT',
      );
    }

    // The entries are now in SQLite and on the queue — the draft has nothing left to protect.
    discardDraft();
    setRestoredNotice(false);

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

    // Scrolls to the reason — the form is taller than the phone, so rendering it alone shows nothing.
    function reject(reason: string | null) {
      setFormError(reason);
      setSaving(false);
      scrollToFirstError();
    }

    if (!isFormReady) {
      reject(null);
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
      // The identity rule, checked where the duplicate would otherwise be minted.
      // The blur check above usually catches this first; a BHW who typed straight
      // through to Save has not seen it yet.
      {
        // Covers the renamed household too: an edited number that lands on another
        // record would leave one purok holding two houses under one number.
        const existing = await findLocalHouseholdByNumber(household.household_number);

        if (existing && existing.household_id !== household.household_id) {
          setExistingMatch(existing);
          reject(`Household ${existing.household_number} is already recorded on this device. Open it to update the record instead of saving a second copy.`);
          return;
        }
      }

      // Before the write, not after — a landed save would leave the BHW deleting a record they never got to decline.
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
          <p className="eyebrow">Household Profiling</p>
          <h2>{isRevisit ? `Update ${household.household_number}` : 'New Household Registration'}</h2>
        </div>
        <Badge label="Saved Offline" tone="success" />
      </div>

      <form className="stack" onSubmit={handleSubmit} onKeyDown={ignoreImplicitSubmit} noValidate>
        {formError ? <p className="form-alert" role="alert"><Icon name="warning" size={18} />{formError}</p> : null}

        {/* Says why the form is not empty. Without it, restored entries read as another
            household's, and the safe move looks like clearing them by hand. */}
        {restoredNotice ? (
          <p className="form-alert tone-info" role="status">
            <Icon name="save" size={18} />
            Unsaved entries from your last visit were restored.
            <Button type="button" variant="ghost" onClick={startBlank}>Start blank</Button>
          </p>
        ) : null}

        {/* The same house, already on this device. Offered rather than applied: only the
            BHW standing at the door can say whether this is that household. */}
        {existingMatch ? (
          <p className="form-alert tone-info" role="status">
            <Icon name="home" size={18} />
            Household {existingMatch.household_number} is already recorded on this device.
            <Button type="button" variant="ghost" onClick={() => void openExisting(existingMatch)}>
              Open it
            </Button>
          </p>
        ) : null}

        {isRevisit ? (
          <p className="form-alert tone-info" role="status">
            <Icon name="save" size={18} />
            Updating the household already on file. Members already recorded stay: open a member's
            own record to mark them moved out, deceased or transferred.
            <Button type="button" variant="ghost" onClick={startBlank}>Record a different household</Button>
          </p>
        ) : null}

        <h3>Household Information</h3>
        <FormField 
          label="Household Number"
          value={household.household_number} 
          onChange={(e) => setHousehold({ ...household, household_number: e.target.value })} 
          onBlur={() => void checkForExisting()}
          placeholder="e.g. HH-001" 
          required 
          error={showValidation && !household.household_number?.trim() ? 'Household number is required.' : undefined}
        />

        <CheckboxGroup
          label="Primary Water Source(s)"
          options={WATER_OPTIONS}
          selectedValues={household.water_source || []}
          onChange={(newValues) => setHousehold({ ...household, water_source: newValues })}
          error={showValidation && !household.water_source?.length ? 'Select at least one water source.' : undefined}
        />

        <CheckboxGroup
          label="Toilet Facility"
          options={TOILET_OPTIONS}
          selectedValues={household.toilet_type || []}
          onChange={(newValues) => setHousehold({ ...household, toilet_type: newValues })}
          error={showValidation && !household.toilet_type?.length ? 'Select at least one toilet facility.' : undefined}
        />

        <CheckboxGroup
          label="Food Production"
          options={FOOD_OPTIONS}
          selectedValues={household.food_production || []}
          onChange={(newValues) => setHousehold({ ...household, food_production: newValues })}
          error={showValidation && !household.food_production?.length ? 'Select at least one food-production option.' : undefined}
        />

        <hr className="form-divider" />

        <h3>Household Members</h3>

        {members.map((member, index) => (
          <div key={index} className="member-card">
            <div className="member-card-heading">
              <h4>Member {index + 1} {member.is_household_head ? '(Head)' : ''}</h4>
              {/* One member is the household itself — there is nothing to remove down to.
                  A member already on file has no removal path at all: nothing deletes
                  through the API, and dropping the row here would only orphan it. */}
              {members.length > 1 && !member.resident_id ? (
                <Button type="button" variant="ghost" onClick={() => requestRemoveMember(index)}>
                  Remove
                </Button>
              ) : null}
            </div>

            <MemberFields
              member={member}
              showValidation={showValidation}
              onChange={(field, value) => updateMember(index, field, value)}
            >
              <MemberChoice
                label="This person is a household head"
                checked={member.is_household_head ?? false}
                onChange={(next) => updateMember(index, 'is_household_head', next)}
              />
            </MemberFields>

            {showValidation && !members.some((entry) => entry.is_household_head) ? <small className="field-error"><b className="required-mark">*</b> Assign one household head.</small> : null}
          </div>
        ))}

        <Button type="button" variant="ghost" className="add-member-action" onClick={addMember}>
          Add another member
        </Button>

        <FormActions>
          <Button type="submit" disabled={saving}>
            <Icon name="save" size={18} />
            {saving ? 'Saving Offline...' : 'Save Complete Household'}
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

      <Modal
        open={removingMember !== null}
        title="Remove this member?"
        onClose={() => setRemovingMember(null)}
      >
        <p className="logout-warning">
          <Icon name="warning" size={20} />
          {removingMember !== null ? memberLabel(members[removingMember], removingMember) : ''}
          {' — '}
          what was typed for this member will be discarded.
        </p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setRemovingMember(null)}>Keep member</Button>
          <Button variant="danger" onClick={() => removingMember !== null && removeMember(removingMember)}>
            Remove
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
