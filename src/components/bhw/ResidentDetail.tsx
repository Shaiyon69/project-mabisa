import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HealthAssessment, Individual, InventoryItem, SupplyDisbursement } from '../../types/database';
import { ageInYears, formatDate, scrollToFirstError, titleCase } from '../../lib/utils';
import {
  readLocalHealthAssessments,
  readLocalIndividual,
  readLocalSupplyDisbursements,
  saveIndividualLocally,
} from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions } from '../common/FormField';
import { Icon } from '../common/Icon';
import { EmptyState } from '../common/StateMessage';
import { MemberChoice, MemberFields } from './MemberFields';
import { useBhwLanguage } from '../../app/BhwLanguageContext';

type ResidentDetailProps = {
  residentId: string;
  /** Names the released items; the disbursement row carries only the item id. */
  inventoryItems: InventoryItem[];
  bhwId: string;
  onSaved: () => Promise<void>;
};

/** Blank optional text is stored as NULL rather than an empty string. */
function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function philhealthDigits(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, '');
  return digits ? digits : null;
}

type ResidentRecord = {
  residentId: string;
  person: Individual | null;
  assessments: HealthAssessment[];
  disbursements: SupplyDisbursement[];
};

/**
 * Everything this screen shows about one resident, read in one go.
 *
 * Outside the component on purpose: the effect below then hands state-setting to
 * a `.then` callback rather than doing it in the effect body, which is the same
 * shape `BHWDashboard` and `IndividualSearch` already use.
 */
async function readResident(residentId: string): Promise<ResidentRecord> {
  const [person, assessments, disbursements] = await Promise.all([
    readLocalIndividual(residentId),
    readLocalHealthAssessments(residentId),
    readLocalSupplyDisbursements(residentId),
  ]);

  return { residentId, person, assessments, disbursements };
}

/**
 * One resident: who they are, every assessment recorded for them, every supply
 * released to them, and a corrections path for the profile.
 *
 * The two histories are read-only by design, not by omission. "History is
 * appended, never overwritten" is an acceptance condition, and an assessment is
 * a measurement taken on a day — a wrong one is corrected by taking another, not
 * by editing the record of what the scale said.
 */
export function ResidentDetail({ residentId, inventoryItems, bhwId, onSaved }: ResidentDetailProps) {
  const { t, isFilipino } = useBhwLanguage();
  const [resident, setResident] = useState<Individual | null>(null);
  const [assessments, setAssessments] = useState<HealthAssessment[]>([]);
  const [disbursements, setDisbursements] = useState<SupplyDisbursement[]>([]);
  // Which resident the three lists above actually describe. Loading is derived
  // from it rather than held as its own flag: navigating from one resident to
  // another reuses this component, and a separate flag raised in the effect body
  // would show the previous person's history under the new person's name for a
  // frame.
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const [draft, setDraft] = useState<Individual | null>(null);
  const [saving, setSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Applying the three reads is one step, so a half-loaded screen — this person's
  // name over the last one's assessments — is not a state this component has.
  const apply = useCallback((loaded: ResidentRecord) => {
    setResident(loaded.person);
    setAssessments(loaded.assessments);
    setDisbursements(loaded.disbursements);
    setLoadedId(loaded.residentId);
  }, []);

  const failed = useCallback((error: unknown) => {
    // Still mark the read as settled, or the screen sits on "Opening record..."
    // with the reason it failed hidden behind it.
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

    if (!draft.first_name.trim() || !draft.last_name.trim() || !draft.birthday) {
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
          // The head has no relationship to themself; promoting someone to head
          // here has to drop the one they carried.
          relationship_to_head: draft.is_household_head ? null : draft.relationship_to_head ?? null,
          // The engine filters every update on this value, so a correction that
          // does not move it forward is indistinguishable from no edit at all.
          updated_at: new Date().toISOString(),
          updated_by: bhwId,
        },
        'UPDATE',
      );

      setDraft(null);
      setShowValidation(false);
      apply(await readResident(residentId));
      await onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Profile changes were not saved.');
      scrollToFirstError();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <p className="muted">{t('Opening record...')}</p>
      </Card>
    );
  }

  if (!resident) {
    return (
      <Card>
        <EmptyState
          title={t('Resident not on this device')}
          text={t('They may belong to another purok, or their record has not synced down yet.')}
        />
        <Link className="ghost-button" to="/bhw/residents">
          {t('Back to residents')}
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
            <p className="eyebrow">{t('Resident')}</p>
            <h2>
              {resident.first_name} {resident.middle_name ? `${resident.middle_name.charAt(0)}. ` : ''}
              {resident.last_name}
            </h2>
          </div>
          {resident.is_household_head ? <Badge label={t('Household Head')} tone="info" /> : null}
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
                label={t('This person is a household head')}
                checked={draft.is_household_head}
                onChange={(next) => setDraft({ ...draft, is_household_head: next })}
              />
            </MemberFields>

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
                {t('Cancel')}
              </Button>
              <Button disabled={saving} onClick={() => void handleSave()}>
                <Icon name="save" size={18} />
                {t(saving ? 'Saving Offline...' : 'Save changes')}
              </Button>
            </FormActions>
          </>
        ) : (
          <>
            <dl className="profile-facts">
              <Fact label={t('Age')} value={age === null ? '—' : `${age} ${t('years old')}`} />
              <Fact label={t('Birthdate')} value={formatDate(resident.birthday)} />
              <Fact label={t('Sex')} value={t(titleCase(resident.sex))} />
              <Fact label={t('Household')} value={resident.household_number ?? '—'} />
              <Fact
                label={t('Relationship to Household Head')}
                value={
                  resident.is_household_head
                    ? t('Household Head')
                    : resident.relationship_to_head
                      ? t(titleCase(resident.relationship_to_head))
                      : '—'
                }
              />
              <Fact label={t('Occupation')} value={resident.occupation ?? '—'} />
              <Fact
                label={t('Educational Attainment')}
                value={resident.educational_attainment ? t(titleCase(resident.educational_attainment)) : '—'}
              />
              <Fact label={t('PhilHealth Number')} value={resident.philhealth_number ?? '—'} />
              <Fact
                label={t('Out-of-school youth')}
                value={t(resident.is_out_of_school_youth ? 'Yes' : 'No')}
              />
              <Fact
                label={t('Pregnant, nursing, or using family planning')}
                value={t(resident.is_pregnant_nursing_fp ? 'Yes' : 'No')}
              />
            </dl>

            {resident.duplicate_override_reason ? (
              <p className="form-hint" role="note">
                <Icon name="warning" size={16} />{' '}
                {t('Saved over a duplicate warning')}
                {resident.duplicate_override_at ? ` • ${formatDate(resident.duplicate_override_at)}` : ''}: “
                {resident.duplicate_override_reason}”
              </p>
            ) : null}

            <Button variant="ghost" onClick={() => setDraft(resident)}>
              <Icon name="user" size={17} />
              {t('Edit profile')}
            </Button>
          </>
        )}
      </Card>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('Recent checks')}</p>
            <h2>{t('Health Assessments')}</h2>
          </div>
          <Badge label={`${assessments.length}`} tone="info" />
        </div>

        {assessments.length ? (
          <ul className="compact-list">
            {assessments.map((assessment) => (
              <li key={assessment.assessment_id}>
                <span>{t(titleCase(assessment.nutrition_status))}</span>
                <small>
                  {assessment.bmi.toFixed(2)} BMI • {assessment.weight} kg • {assessment.height} cm •{' '}
                  {formatDate(assessment.assessment_date)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('No assessments yet')} text={t('Saved health assessments will appear here.')} />
        )}
      </Card>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('Inventory')}</p>
            <h2>{t('Supplies Released')}</h2>
          </div>
          <Badge label={`${disbursements.length}`} tone="info" />
        </div>

        {disbursements.length ? (
          <ul className="compact-list">
            {disbursements.map((release) => {
              const item = inventoryItems.find((entry) => entry.item_id === release.item_id);

              return (
                <li key={release.log_id}>
                  <span>{item?.item_name ?? t('Item not on this device')}</span>
                  <small>
                    {release.quantity} {isFilipino ? 'piraso' : 'item(s)'} • {formatDate(release.disbursement_date)}
                  </small>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title={t('No supplies released')} text={t('Supply releases to this resident appear here.')} />
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
