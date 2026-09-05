import { useRef, useState } from 'react';
import type { HealthAssessment, Individual, NutritionStatus } from '../../types/database';
import {
  ADULT_BMI_MIN_AGE,
  ageInYears,
  calculateBmi,
  createId,
  describeMissing,
  getNutritionStatus,
  HEIGHT_CM_RANGE,
  ignoreImplicitSubmit,
  isInFuture,
  isMeasurementInRange,
  scrollToFirstError,
  titleCase,
  today,
  WEIGHT_KG_RANGE,
} from '../../lib/utils';
import { saveHealthAssessmentLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField } from '../common/FormField';
import { IndividualSearch } from './IndividualSearch';
import { Icon } from '../common/Icon';

// Roughly the range a field BMI lands in. A reading outside it still resolves to
// a band; the marker parks at the end of the scale.
const BMI_MIN = 12;
const BMI_MAX = 40;

// getNutritionStatus() written out, so the BHW sees the rule behind the verdict.
const BMI_BANDS = [
  { status: 'underweight', from: BMI_MIN, to: 18.5 },
  { status: 'normal', from: 18.5, to: 25 },
  { status: 'overweight', from: 25, to: 30 },
  { status: 'obese', from: 30, to: BMI_MAX },
] as const satisfies readonly { status: NutritionStatus; from: number; to: number }[];

const BMI_TICKS = [18.5, 25, 30];


// BMI is not a nutrition measure during pregnancy or nursing: recorded, but flagged.

function bmiCaveats(person: Individual | null): string[] {
  if (!person) {
    return [];
  }

  const age = ageInYears(person.birthday);

  return [
    age !== null &&
      age < ADULT_BMI_MIN_AGE &&
      `This resident is ${age} years old. Adult BMI does not classify anyone under ${ADULT_BMI_MIN_AGE} — read the result against the DOH/WHO growth chart instead.`,
    // One column covers all three; only pregnancy and nursing invalidate the reading.
    person.is_pregnant_nursing_fp &&
      'This resident is marked pregnant, nursing, or on family planning. If pregnant or nursing, BMI does not show their nutrition status.',
  ].filter(Boolean) as string[];
}

if (import.meta.env.DEV) {
  // Cheap guard against the rail drifting away from the function it illustrates.
  for (const band of BMI_BANDS) {
    console.assert(
      getNutritionStatus((band.from + band.to) / 2) === band.status,
      `BMI rail band "${band.status}" no longer matches getNutritionStatus()`,
    );
  }
}

function railPercent(bmi: number): number {
  return ((Math.min(Math.max(bmi, BMI_MIN), BMI_MAX) - BMI_MIN) / (BMI_MAX - BMI_MIN)) * 100;
}

type HealthAssessmentFormProps = {
  individualCount: number;
  onSaved: () => Promise<void>;
};

export function HealthAssessmentForm({ individualCount, onSaved }: HealthAssessmentFormProps) {
  const [residentId, setResidentId] = useState('');
  const [resident, setResident] = useState<Individual | null>(null);
  const [assessmentDate, setAssessmentDate] = useState(today());
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  
  const bmi = calculateBmi(Number(weight), Number(height));
  const nutritionStatus = getNutritionStatus(bmi);
  const hasIndividuals = individualCount > 0;
  const missingRequirements = [
    !hasIndividuals && 'a registered resident',
    !residentId && 'the resident being checked',
    !assessmentDate && 'the date of the check',
    isInFuture(assessmentDate) && 'a date on or before today',
    (!isMeasurementInRange(weight, WEIGHT_KG_RANGE) ||
      !isMeasurementInRange(height, HEIGHT_CM_RANGE) ||
      !bmi ||
      !nutritionStatus) &&
      'a weight and height within range',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;
  const caveats = bmiCaveats(resident);
  // Minted once and held until the row lands, so a retry updates the same
  // assessment rather than recording the visit twice.
  const pendingId = useRef<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setFormError(null);

    if (!isFormReady || !bmi || !nutritionStatus) {
      setFormError(describeMissing(missingRequirements));
      scrollToFirstError();
      return;
    }

    setSaving(true);
    const timestamp = new Date().toISOString();
    
    pendingId.current ??= createId();

    const assessment: HealthAssessment = {
      assessment_id: pendingId.current,
      resident_id: residentId,
      assessment_date: assessmentDate,
      weight: Number(weight),
      height: Number(height),
      bmi,
      nutrition_status: nutritionStatus,
      created_at: timestamp,
      updated_at: timestamp,
    };

    try {
      await saveHealthAssessmentLocally(assessment);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'This health check was not saved.');
      scrollToFirstError();
      setSaving(false);
      return;
    }

    // The assessment is in SQLite and on the queue, so nothing below may report it
    // as unsaved.
    pendingId.current = null;
    setWeight('');
    setHeight('');
    setAssessmentDate(today());
    setResidentId('');
    setResident(null);
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
          <p className="eyebrow">Health check</p>
          <h2>Health Check</h2>
        </div>
        <Badge label={hasIndividuals ? 'Ready' : 'No residents yet'} tone={hasIndividuals ? 'success' : 'warning'} />
      </div>
      <form className="stack" onSubmit={handleSubmit} onKeyDown={ignoreImplicitSubmit} noValidate>
        {formError ? <p className="form-alert" role="alert"><Icon name="warning" size={18} />{formError}</p> : null}
        
        <IndividualSearch
          selectedResidentId={residentId}
          onChange={(nextId, person) => {
            setResidentId(nextId);
            setResident(person);
          }}
          error={showValidation && !residentId ? 'Select a resident.' : undefined}
        />
        
        {!hasIndividuals ? <p className="form-hint">Register a household first.</p> : null}
        
        <FormField 
          label="Date of Check"
          type="date" 
          max={today()} 
          value={assessmentDate} 
          onChange={(event) => setAssessmentDate(event.target.value)} 
          required 
          error={
            showValidation && !assessmentDate
              ? 'The date of the check is required.'
              : showValidation && isInFuture(assessmentDate)
                ? 'The date cannot be in the future.'
                : undefined
          }
        />
        <div className="field-row">
          <FormField 
            label="Weight (kg)"
            type="number" 
            min={WEIGHT_KG_RANGE.min}
            max={WEIGHT_KG_RANGE.max}
            step="0.1"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            required
            error={showValidation && !isMeasurementInRange(weight, WEIGHT_KG_RANGE) ? 'Enter a weight from 1 to 300 kg.' : undefined}
          />
          <FormField 
            label="Height (cm)"
            type="number" 
            min={HEIGHT_CM_RANGE.min}
            max={HEIGHT_CM_RANGE.max}
            step="0.1"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            required
            error={showValidation && !isMeasurementInRange(height, HEIGHT_CM_RANGE) ? 'Enter a height from 30 to 250 cm.' : undefined}
          />
        </div>
        <BmiRail bmi={bmi} status={nutritionStatus} />
        {/* Shown against the selected resident only — an always-on caveat reads as decoration by week two. */}
        {caveats.map((caveat) => (
          <p key={caveat} className="form-alert tone-warning" role="note">
            <Icon name="warning" size={18} />
            {caveat}
          </p>
        ))}
        <FormActions>
          <Button type="submit" disabled={saving}>
            <Icon name="save" size={18} />
            {saving ? 'Saving...' : 'Save Assessment'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}

// The numeric readout is authoritative and the scale repeats it, so this is hidden from screen readers.
function BmiRail({ bmi, status }: { bmi: number | null; status: NutritionStatus | null }) {
  return (
    <section className="bmi-rail">
      <div className="bmi-readout">
        <p className="eyebrow">Body Mass Index (BMI)</p>
        <strong>{bmi ? bmi.toFixed(1) : '--'}</strong>
        <output className={`bmi-verdict${status ? ` bmi-verdict-${status}` : ''}`}>
          {status ? titleCase(status) : 'Enter weight and height'}
        </output>
      </div>

      <div className="bmi-scale" aria-hidden="true">
        <div className="bmi-bands">
          {BMI_BANDS.map((band) => (
            <span
              key={band.status}
              className={`bmi-band bmi-band-${band.status}${status === band.status ? ' is-active' : ''}`}
              style={{ width: `${railPercent(band.to) - railPercent(band.from)}%` }}
            />
          ))}
        </div>

        {bmi ? <span className="bmi-marker" style={{ left: `${railPercent(bmi)}%` }} /> : null}

        {BMI_TICKS.map((tick) => (
          <span key={tick} className="bmi-tick" style={{ left: `${railPercent(tick)}%` }}>
            {tick}
          </span>
        ))}
      </div>
    </section>
  );
}
