import { useEffect, useRef, useState } from 'react';
import type { Household, Individual } from '../../types/database';
import { createId, describeMissing, emptyToNull, HOUSEHOLD_DRAFT_PREFIX, ignoreImplicitSubmit, isInFuture, philhealthDigits, scrollToFirstError } from '../../lib/utils';
import { findLikelyDuplicates } from '../../lib/duplicates';
import {
  findLocalHouseholdByNumber,
  readLocalIndividuals,
  saveHouseholdWithMembersLocally,
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

// Accepts dashes and spaces on input, as written on paper forms; stored digits-only.
const PHILHEALTH_ALLOWED = /^[\d\s-]+$/;

/**
 * Entries kept in local storage as they are typed and offered back on the next
 * visit, so a backgrounded tab is an interruption rather than a re-survey. Keyed
 * per health worker, so two accounts on one device stay separate.
 */
type HouseholdDraft = {
  household: Partial<Household>;
  members: Partial<Individual>[];
  savedAt: string;
};

function draftKey(bhwId: string): string {
  return `${HOUSEHOLD_DRAFT_PREFIX}${bhwId}`;
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

/** An empty household and an empty member row, which the form starts, resets and grows rows from. */
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
  // Members that look like an existing record, plus the reason for saving anyway.
  // Non-empty `flagged` holds the save until the warning is answered.
  const [flagged, setFlagged] = useState<FlaggedMember[]>([]);
  // Keyed by member number: each flagged member's reason is stored on that
  // member's own record, so they cannot share one.
  const [overrideReasons, setOverrideReasons] = useState<Record<number, string>>({});
  // The household already recorded under the number being typed. Offered, never
  // forced.
  const [existingMatch, setExistingMatch] = useState<Household | null>(null);
  // Index of the member the BHW asked to remove, held until they confirm. Only a
  // row with something typed in it gets that question.
  const [removingMember, setRemovingMember] = useState<number | null>(null);
  // The pending draft write, so a save can cancel one that is still armed.
  const draftTimer = useRef<number | undefined>(undefined);
  // Ids for a save that has not landed. Held here rather than in state, so a
  // retry reuses them without turning the pending INSERT into an UPDATE.
  const pendingIds = useRef<{ householdId: string; memberIds: string[] } | null>(null);
  // A form carrying a household id is editing that household, not creating one.
  const isRevisit = Boolean(household.household_id);
  // Numbered, because a household of six rows is taller than the phone and
  // "member names and birthdates" leaves the BHW scrolling for the blank one.
  const incompleteMembers = members
    .map((member, index) =>
      member.first_name?.trim() && member.last_name?.trim() && member.birthday && member.sex ? null : index + 1,
    )
    .filter((memberNumber): memberNumber is number => memberNumber !== null);
  const missingRequirements = [
    !household.household_number?.trim() && 'household number',
    !household.water_source?.length && 'water source',
    !household.toilet_type?.length && 'toilet facility',
    !household.food_production?.length && 'food production',
    incompleteMembers.length > 0 &&
      `name, birthdate and sex for member${incompleteMembers.length > 1 ? 's' : ''} ${incompleteMembers.join(', ')}`,
    !members.some((member) => member.is_household_head) && 'household head',
    members.some((member) => isInFuture(member.birthday)) && 'birthdates on or before today',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;

  // Nothing typed yet is not a draft, so an untouched form is not offered back.
  const hasEntries =
    Boolean(household.household_number?.trim()) ||
    Boolean(household.health_status_notes?.trim()) ||
    Boolean(household.toilet_type?.length) ||
    Boolean(household.water_source?.length) ||
    Boolean(household.food_production?.length) ||
    members.some((member) => memberHasEntries(member));

  // Debounced: without the timer this writes the whole household to local storage
  // on every keystroke. A crash now costs the last half-second of typing.
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
   * Discards the draft for good. The pending write is cancelled first, or a timer
   * still armed from the debounce window puts the draft back after the save.
   */
  function discardDraft() {
    window.clearTimeout(draftTimer.current);
    clearDraft(bhwId);
  }

  function startBlank() {
    discardDraft();
    pendingIds.current = null;
    setHousehold(blankHousehold());
    setMembers([blankMember(true)]);
    setFlagged([]);
    setShowValidation(false);
    setRestoredNotice(false);
    setExistingMatch(null);
  }

  /** Looks for an existing record under the number just typed, so a re-visit is offered. */
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

    pendingIds.current = null;
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
   * Only local SQLite is consulted, so cross-purok duplicates are the portal's to catch.
   */
  async function scanForDuplicates(): Promise<FlaggedMember[]> {
    const scans = await Promise.all(
      members.map(async (member, index) => {
        // Former members included: someone who moved out and came back is who
        // this warning exists to catch.
        const candidates = (await readLocalIndividuals({ searchQuery: member.last_name?.trim(), includeFormer: true }))
          // On a re-visit every member matches themselves, so only people outside
          // this household are worth raising.
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
   * Writes the household and every member. `overriddenMembers` carries the flagged
   * members once the BHW confirms they are different people, each stamped with the
   * record shown, the reason, and who confirmed it.
   */
  async function persistHousehold(overriddenMembers: FlaggedMember[], reasons: Record<number, string>): Promise<void> {
    // A re-visit keeps the ids it was opened with; new members are still inserts.
    // A row added since a failed attempt is past the end of the held list.
    const held = pendingIds.current;
    const householdId = held?.householdId ?? household.household_id ?? createId();
    const memberIds = members.map(
      (member, index) => member.resident_id ?? held?.memberIds[index] ?? createId(),
    );

    pendingIds.current = { householdId, memberIds };
    const timestamp = new Date().toISOString();
    const overrideByMemberNumber = new Map(overriddenMembers.map((member) => [member.memberNumber, member]));

    // The whole visit in one transaction and one flush. See saveHouseholdWithMembersLocally.
    await saveHouseholdWithMembersLocally(
      {
        row: {
          ...(household as Household),
          household_id: householdId,
          created_at: household.created_at ?? timestamp,
          updated_at: timestamp,
        },
        operationType: isRevisit ? 'UPDATE' : 'INSERT',
      },
      members.map((member, index) => {
        // Sorted most convincing first, so the head of the list is the record the
        // BHW was weighing this person against.
        const overridden = overrideByMemberNumber.get(index + 1);

        return {
          row: {
            ...(member as Individual),
            resident_id: memberIds[index],
            household_id: householdId,
            // Normalised so the column holds NULL rather than an empty string,
            // which reads the same in the UI but not in a query.
            occupation: emptyToNull(member.occupation),
            educational_attainment: emptyToNull(member.educational_attainment),
            philhealth_number: philhealthDigits(member.philhealth_number),
            // Stripped here, not on tick, so unticking keeps the answer already given.
            relationship_to_head: member.is_household_head ? null : member.relationship_to_head ?? null,
            created_at: member.created_at ?? timestamp,
            updated_at: timestamp,
            updated_by: bhwId,
            // Falls back to what the member already carries, so a re-visit raising no
            // new warning does not erase an earlier override.
            duplicate_override_of: overridden?.matches[0]?.person.resident_id ?? member.duplicate_override_of ?? null,
            duplicate_override_reason: overridden
              ? reasons[overridden.memberNumber]?.trim() ?? null
              : member.duplicate_override_reason ?? null,
            duplicate_override_by: overridden ? bhwId : member.duplicate_override_by ?? null,
            duplicate_override_at: overridden ? timestamp : member.duplicate_override_at ?? null,
          },
          operationType: member.resident_id ? ('UPDATE' as const) : ('INSERT' as const),
        };
      }),
    );

    // In SQLite and on the queue: nothing left for the draft or the held ids to protect.
    pendingIds.current = null;
    discardDraft();
    setRestoredNotice(false);
  }

  /**
   * Runs after the household is committed. Neither refreshing the list nor leaving
   * the form un-saves anything, so a failure here is not reported as a failed save.
   */
  async function leaveAfterSave(): Promise<void> {
    try {
      await onSaved();
    } catch {
      setFormError('Household was saved. The screen could not be refreshed — it is on the queue either way.');
      scrollToFirstError();
    }
  }

  async function handleOverride() {
    setSaving(true);
    setFormError(null);

    try {
      await persistHousehold(flagged, overrideReasons);
    } catch (error) {
      setFlagged([]);
      setFormError(error instanceof Error ? error.message : 'Household profile was not saved.');
      scrollToFirstError();
      setSaving(false);
      return;
    }

    setFlagged([]);
    setOverrideReasons({});
    setSaving(false);
    await leaveAfterSave();
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
      reject(describeMissing(missingRequirements));
      return;
    }

    // Length is left unchecked: a partially remembered ID is still worth recording.
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
      // The blur check above usually catches this first.
      {
        // Covers the renamed household too, which would otherwise leave one purok
        // holding two houses under one number.
        const existing = await findLocalHouseholdByNumber(household.household_number);

        if (existing && existing.household_id !== household.household_id) {
          setExistingMatch(existing);
          reject(`Household ${existing.household_number} is already recorded on this device. Open it to update the record instead of saving a second copy.`);
          return;
        }
      }

      // Before the write: a landed save leaves the BHW deleting a record they never declined.
      const flaggedMembers = await scanForDuplicates();

      if (flaggedMembers.length > 0) {
        setFlagged(flaggedMembers);
        setSaving(false);
        return;
      }

      await persistHousehold([], {});
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Household profile was not saved.');
      scrollToFirstError();
      setSaving(false);
      return;
    }

    setSaving(false);
    await leaveAfterSave();
  }

  return (
    <Card className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Household Profiling</p>
          <h2>{isRevisit ? `Update ${household.household_number}` : 'New Household Registration'}</h2>
        </div>
        {/* Neutral, and phrased as a capability: a green tick reading "Saved
            Offline" over a form that has saved nothing says the visit is done. */}
        <Badge label="Works offline" />
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
          required
          options={WATER_OPTIONS}
          selectedValues={household.water_source || []}
          onChange={(newValues) => setHousehold({ ...household, water_source: newValues })}
          error={showValidation && !household.water_source?.length ? 'Select at least one water source.' : undefined}
        />

        <CheckboxGroup
          label="Toilet Facility"
          required
          options={TOILET_OPTIONS}
          selectedValues={household.toilet_type || []}
          onChange={(newValues) => setHousehold({ ...household, toilet_type: newValues })}
          error={showValidation && !household.toilet_type?.length ? 'Select at least one toilet facility.' : undefined}
        />

        <CheckboxGroup
          label="Food Production"
          required
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
        reasons={overrideReasons}
        saving={saving}
        onReasonChange={(memberNumber, reason) =>
          setOverrideReasons((current) => ({ ...current, [memberNumber]: reason }))
        }
        // Keeps what was typed: the backdrop is a large target on a phone, and
        // discarding the reasons on a stray tap costs the whole answer.
        onCancel={() => setFlagged([])}
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
