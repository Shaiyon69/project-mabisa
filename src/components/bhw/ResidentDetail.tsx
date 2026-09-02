import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RESIDENT_STATUSES, type HealthAssessment, type Individual, type InventoryItem, type SupplyDisbursement } from '../../types/database';
import {
  ageInYears,
  emptyToNull,
  formatDate,
  isInFuture,
  philhealthDigits,
  scrollToFirstError,
  statusChangedOn,
  titleCase,
} from '../../lib/utils';
import {
  readLocalHealthAssessments,
  readLocalIndividual,
  readLocalSupplyDisbursements,
  saveIndividualLocally,
} from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, SelectField } from '../common/FormField';
import { Icon } from '../common/Icon';
import { EmptyState } from '../common/StateMessage';
import { MemberChoice, MemberFields } from './MemberFields';

type ResidentDetailProps = {
  residentId: string;
  /** Names the released items; the disbursement row carries only the item id. */
  inventoryItems: InventoryItem[];
  bhwId: string;
  onSaved: () => Promise<void>;
};

type ResidentRecord = {
  residentId: string;
  person: Individual | null;
  assessments: HealthAssessment[];
  disbursements: SupplyDisbursement[];
};

/** Everything this screen shows about one resident, read in one go. */
async function readResident(residentId: string): Promise<ResidentRecord> {
  const [person, assessments, disbursements] = await Promise.all([
    readLocalIndividual(residentId),
    readLocalHealthAssessments(residentId),
    readLocalSupplyDisbursements(residentId),
  ]);

  return { residentId, person, assessments, disbursements };
}

/**
 * One resident: who they are, every assessment and supply release, and a
 * corrections path for the profile. The two histories are read-only: a wrong
 * measurement is corrected by taking another.
 */
export function ResidentDetail({ residentId, inventoryItems, bhwId, onSaved }: ResidentDetailProps) {
  const [resident, setResident] = useState<Individual | null>(null);
  const [assessments, setAssessments] = useState<HealthAssessment[]>([]);
  const [disbursements, setDisbursements] = useState<SupplyDisbursement[]>([]);
  // Which resident the three lists above describe. `loading` is derived from it,
  // so moving between residents never flashes one person's history under another's name.
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const [draft, setDraft] = useState<Individual | null>(null);
  const [saving, setSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The three reads applied in one step, so a name never pairs with another person's assessments.
  const apply = useCallback((loaded: ResidentRecord) => {
    setResident(loaded.person);
    setAssessments(loaded.assessments);
    setDisbursements(loaded.disbursements);
    setLoadedId(loaded.residentId);
  }, []);

  const failed = useCallback((error: unknown) => {
    // Still mark the read as settled, or the screen sits on "Opening record...".
    setResident(null);
    setLoadedId(residentId);
    setFormError(error instanceof Error ? error.message : 'Could not open this resident.');
  }, [residentId]);

  useEffect(() => {
    readResident(residentId).then(apply).catch(failed);
  }, [residentId, apply, failed]);

  const loading = loadedId !== residentId;

  async function handleSave() {
    if (!draft) {
      return;
    }

    setShowValidation(true);
    setFormError(null);

    if (!draft.first_name.trim() || !draft.last_name.trim() || !draft.birthday || isInFuture(draft.birthday)) {
      scrollToFirstError();
      return;
    }

    setSaving(true);

    try {
      await saveIndividualLocally(
        {
          ...draft,
          occupation: emptyToNull(draft.occupation),
          educational_attainment: emptyToNull(draft.educational_attainment),
          philhealth_number: philhealthDigits(draft.philhealth_number),
          // The head has no relationship to themself, so promoting someone drops
          // the one they carried.
          relationship_to_head: draft.is_household_head ? null : draft.relationship_to_head ?? null,
          // The engine filters every update on this value, so a correction that
          // does not move it forward reads as no edit.
          updated_at: new Date().toISOString(),
          updated_by: bhwId,
          // A member who left is marked rather than deleted: the assessments and
          // supply releases hang off this row.
          status: draft.status ?? 'active',
          status_changed_on: statusChangedOn(resident?.status, draft.status, draft.status_changed_on),
        },
        'UPDATE',
      );

    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Profile changes were not saved.');
      scrollToFirstError();
      setSaving(false);
      return;
    }

    // The correction is written and queued. Neither the re-read nor the refresh
    // below un-saves it, so neither reports a failed save.
    setDraft(null);
    setShowValidation(false);
    setSaving(false);

    try {
      apply(await readResident(residentId));
      await onSaved();
    } catch {
      setFormError('Changes were saved. The screen could not be refreshed — reopen the resident to see them.');
    }
  }

  if (loading) {
    return (
      <Card>
        <p className="muted">Opening record...</p>
      </Card>
    );
  }

  if (!resident) {
    return (
      <Card>
        <EmptyState
          title="Resident not on this device"
          text="They may belong to another purok, or their record has not synced down yet."
        />
        <Link className="ghost-button" to="/bhw/residents">
          Back to residents
        </Link>
      </Card>
    );
  }

  const age = ageInYears(resident.birthday);
  const editing = draft !== null;

  return (
    <div className="dashboard-grid">
      <Card className="form-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Resident</p>
            <h2>
              {resident.first_name} {resident.middle_name ? `${resident.middle_name.charAt(0)}. ` : ''}
              {resident.last_name}
            </h2>
          </div>
          {resident.status && resident.status !== 'active' ? (
            <Badge label={titleCase(resident.status)} tone="warning" />
          ) : resident.is_household_head ? (
            <Badge label="Household Head" tone="info" />
          ) : null}
        </div>

        {formError ? (
          <p className="form-alert" role="alert">
            <Icon name="warning" size={18} />
            {formError}
          </p>
        ) : null}

        {editing ? (
          <>
            <MemberFields
              member={draft}
              showValidation={showValidation}
              onChange={(field, value) => setDraft({ ...draft, [field]: value })}
            >
              <MemberChoice
                label="This person is a household head"
                checked={draft.is_household_head}
                onChange={(next) => setDraft({ ...draft, is_household_head: next })}
              />
            </MemberFields>

            <SelectField
              label="Still in this household?"
              hint="A member who left stays on file — every check and supply release recorded for them stays attached."
              value={draft.status ?? 'active'}
              onChange={(event) => setDraft({ ...draft, status: event.target.value as Individual['status'] })}
            >
              {RESIDENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status === 'active' ? 'Yes, still a member' : titleCase(status)}
                </option>
              ))}
            </SelectField>

            <FormActions>
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                  setShowValidation(false);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
              <Button disabled={saving} onClick={() => void handleSave()}>
                <Icon name="save" size={18} />
                {saving ? 'Saving Offline...' : 'Save changes'}
              </Button>
            </FormActions>
          </>
        ) : (
          <>
            <dl className="profile-facts">
              <Fact label="Age" value={age === null ? '—' : `${age} years old`} />
              <Fact label="Birthdate" value={formatDate(resident.birthday)} />
              <Fact label="Sex" value={titleCase(resident.sex)} />
              <Fact label="Household" value={resident.household_number ?? '—'} />
              <Fact
                label="Household membership"
                value={
                  !resident.status || resident.status === 'active'
                    ? 'Active member'
                    : `${titleCase(resident.status)}${resident.status_changed_on ? ` • ${formatDate(resident.status_changed_on)}` : ''}`
                }
              />
              <Fact
                label="Relationship to Household Head"
                value={
                  resident.is_household_head
                    ? 'Household Head'
                    : resident.relationship_to_head
                      ? titleCase(resident.relationship_to_head)
                      : '—'
                }
              />
              <Fact label="Occupation" value={resident.occupation ?? '—'} />
              <Fact
                label="Educational Attainment"
                value={resident.educational_attainment ? titleCase(resident.educational_attainment) : '—'}
              />
              <Fact label="PhilHealth Number" value={resident.philhealth_number ?? '—'} />
              <Fact
                label="Out-of-school youth"
                value={resident.is_out_of_school_youth ? 'Yes' : 'No'}
              />
              <Fact
                label="Pregnant, nursing, or using family planning"
                value={resident.is_pregnant_nursing_fp ? 'Yes' : 'No'}
              />
            </dl>

            {resident.duplicate_override_reason ? (
              <p className="form-hint" role="note">
                <Icon name="warning" size={16} />{' '}
                Saved over a duplicate warning
                {resident.duplicate_override_at ? ` • ${formatDate(resident.duplicate_override_at)}` : ''}: “
                {resident.duplicate_override_reason}”
              </p>
            ) : null}

            <Button variant="ghost" onClick={() => setDraft(resident)}>
              <Icon name="user" size={17} />
              Edit profile
            </Button>
          </>
        )}
      </Card>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recent checks</p>
            <h2>Health Assessments</h2>
          </div>
          <Badge label={`${assessments.length}`} tone="info" />
        </div>

        {assessments.length ? (
          <ul className="compact-list">
            {assessments.map((assessment) => (
              <li key={assessment.assessment_id}>
                <span>{titleCase(assessment.nutrition_status)}</span>
                <small>
                  {assessment.bmi.toFixed(2)} BMI • {assessment.weight} kg • {assessment.height} cm •{' '}
                  {formatDate(assessment.assessment_date)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No assessments yet" text="Saved health assessments will appear here." />
        )}
      </Card>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inventory</p>
            <h2>Supplies Released</h2>
          </div>
          <Badge label={`${disbursements.length}`} tone="info" />
        </div>

        {disbursements.length ? (
          <ul className="compact-list">
            {disbursements.map((release) => {
              const item = inventoryItems.find((entry) => entry.item_id === release.item_id);

              return (
                <li key={release.log_id}>
                  <span>{item?.item_name ?? 'Item not on this device'}</span>
                  <small>
                    {release.quantity} item(s) • {formatDate(release.disbursement_date)}
                  </small>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No supplies released" text="Supply releases to this resident appear here." />
        )}
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
