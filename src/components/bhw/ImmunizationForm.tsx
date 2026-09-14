import { useRef, useState } from 'react';
import type { Immunization } from '../../types/database';
import {
  createId,
  describeMissing,
  ignoreImplicitSubmit,
  isInFuture,
  isWholeNumberInRange,
  scrollToFirstError,
  today,
  VACCINE_OPTIONS,
} from '../../lib/utils';
import { saveImmunizationLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField } from '../common/FormField';
import { IndividualSearch } from './IndividualSearch';
import { Icon } from '../common/Icon';

const DOSE_NUMBER_RANGE = { min: 1, max: 10 };

type ImmunizationFormProps = {
  individualCount: number;
  bhwId: string;
  onSaved: () => Promise<void>;
};

/** One dose given to a resident — no schedule or due-date engine, just a log. */
export function ImmunizationForm({ individualCount, bhwId, onSaved }: ImmunizationFormProps) {
  const [residentId, setResidentId] = useState('');
  const [vaccineName, setVaccineName] = useState('');
  const [doseNumber, setDoseNumber] = useState('');
  const [dateGiven, setDateGiven] = useState(today());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  const hasIndividuals = individualCount > 0;
  const doseOk = doseNumber.trim() === '' || isWholeNumberInRange(doseNumber, DOSE_NUMBER_RANGE);
  const missingRequirements = [
    !doseOk && 'a dose number from 1 to 10',
    !hasIndividuals && 'a registered resident',
    !residentId && 'the resident given the dose',
    !vaccineName.trim() && 'the vaccine given',
    !dateGiven && 'the date given',
    isInFuture(dateGiven) && 'a date on or before today',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;
  // Minted once and held until the row lands, so a retry updates the same dose rather than logging it twice.
  const pendingId = useRef<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setFormError(null);

    if (!isFormReady) {
      setFormError(describeMissing(missingRequirements));
      scrollToFirstError();
      return;
    }

    setSaving(true);
    const timestamp = new Date().toISOString();
    pendingId.current ??= createId();

    const immunization: Immunization = {
      immunization_id: pendingId.current,
      resident_id: residentId,
      vaccine_name: vaccineName.trim(),
      dose_number: doseNumber.trim() === '' ? null : Number(doseNumber),
      date_given: dateGiven,
      // Stamped for real by private.stamp_immunization_actor() on the server —
      // this is only what the offline row shows until it syncs.
      given_by: bhwId,
      created_at: timestamp,
      updated_at: timestamp,
    };

    try {
      await saveImmunizationLocally(immunization, 'INSERT');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'This immunization was not saved.');
      scrollToFirstError();
      setSaving(false);
      return;
    }

    pendingId.current = null;
    setVaccineName('');
    setDoseNumber('');
    setDateGiven(today());
    setResidentId('');
    setSaving(false);

    try {
      await onSaved();
    } catch {
      setFormError('Saved. The screen did not refresh, but the record is on this phone.');
    }
  }

  return (
    <Card className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Immunization</p>
          <h2>Immunization</h2>
        </div>
        <Badge label={hasIndividuals ? 'Ready' : 'No residents yet'} tone={hasIndividuals ? 'success' : 'warning'} />
      </div>
      <form className="stack" onSubmit={handleSubmit} onKeyDown={ignoreImplicitSubmit} noValidate>
        {formError ? <p className="form-alert" role="alert"><Icon name="warning" size={18} />{formError}</p> : null}

        <IndividualSearch
          selectedResidentId={residentId}
          onChange={(nextId) => setResidentId(nextId)}
          error={showValidation && !residentId ? 'Select a resident.' : undefined}
        />

        {!hasIndividuals ? <p className="form-hint">Register a household first.</p> : null}

        <datalist id="vaccine-options">
          {VACCINE_OPTIONS.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <FormField
          label="Vaccine"
          list="vaccine-options"
          value={vaccineName}
          onChange={(event) => setVaccineName(event.target.value)}
          placeholder="e.g. BCG"
          required
          error={showValidation && !vaccineName.trim() ? 'Name the vaccine given.' : undefined}
        />
        <div className="field-row">
          <FormField
            label="Dose number"
            type="number"
            min={DOSE_NUMBER_RANGE.min}
            max={DOSE_NUMBER_RANGE.max}
            value={doseNumber}
            onChange={(event) => setDoseNumber(event.target.value)}
            placeholder="(Optional)"
            error={showValidation && !doseOk ? 'Enter a whole number from 1 to 10.' : undefined}
          />
          <FormField
            label="Date given"
            type="date"
            max={today()}
            value={dateGiven}
            onChange={(event) => setDateGiven(event.target.value)}
            required
            error={
              showValidation && !dateGiven
                ? 'The date given is required.'
                : showValidation && isInFuture(dateGiven)
                  ? 'The date cannot be in the future.'
                  : undefined
            }
          />
        </div>

        <FormActions>
          <Button type="submit" disabled={saving}>
            <Icon name="save" size={18} />
            {saving ? 'Saving...' : 'Save Immunization'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
