import { useState } from 'react';
import type { HealthAssessment, Individual, NutritionStatus } from '../../types/database';
import {
  ageInYears,
  calculateBmi,
  createId,
  getNutritionStatus,
  HEIGHT_CM_RANGE,
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
import { useBhwLanguage } from '../../app/bhwLanguage';

// The rail draws roughly the range a field BMI lands in; readings outside it
// still resolve to a band, the marker just parks at the end of the scale.
const BMI_MIN = 12;
const BMI_MAX = 40;

// The cut-points are getNutritionStatus() written out, which is the whole point
// of the rail: the BHW sees the rule that produced the verdict.
const BMI_BANDS = [
  { status: 'underweight', from: BMI_MIN, to: 18.5 },
  { status: 'normal', from: 18.5, to: 25 },
  { status: 'overweight', from: 25, to: 30 },
  { status: 'obese', from: 30, to: BMI_MAX },
] as const satisfies readonly { status: NutritionStatus; from: number; to: number }[];

const BMI_TICKS = [18.5, 25, 30];


// WHO reads under-20s off BMI-for-age z-scores, not these fixed cut-points, and
// BMI isn't a nutrition measure during pregnancy/nursing — recorded anyway, but flagged as not applying.
const ADULT_BMI_MIN_AGE = 20;

// Written per language here (not the flat dictionary) since both lines interpolate the resident's age.
function bmiCaveats(person: Individual | null, isFilipino: boolean): string[] {
  if (!person) {
    return [];
  }

  const age = ageInYears(person.birthday);

  return [
    age !== null &&
      age < ADULT_BMI_MIN_AGE &&
      (isFilipino
        ? `${age} taong gulang ang residenteng ito. Hindi umaabot sa wastong pagsusuri ang adult BMI sa wala pang ${ADULT_BMI_MIN_AGE} — gamitin ang growth chart ng DOH/WHO.`
        : `This resident is ${age} years old. Adult BMI does not classify anyone under ${ADULT_BMI_MIN_AGE} — read the result against the DOH/WHO growth chart instead.`),
    // One column covers all three (pregnant/nursing/family planning) — only the first two invalidate the reading.
    person.is_pregnant_nursing_fp &&
      (isFilipino
        ? 'Nakatala ang residenteng ito bilang buntis, nagpapasuso, o gumagamit ng family planning. Kung buntis o nagpapasuso, hindi sinusukat ng BMI ang kanyang nutrition status.'
        : 'This resident is flagged pregnant, nursing, or on family planning. If pregnant or nursing, BMI does not measure their nutrition status.'),
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
  const { t, isFilipino } = useBhwLanguage();
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
    !hasIndividuals && 'registered resident',
    !residentId && 'selected resident',
    !assessmentDate && 'assessment date',
    (!isMeasurementInRange(weight, WEIGHT_KG_RANGE) ||
      !isMeasurementInRange(height, HEIGHT_CM_RANGE) ||
      !bmi ||
      !nutritionStatus) &&
      'valid weight and height',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;
  const caveats = bmiCaveats(resident, isFilipino);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setFormError(null);

    if (!isFormReady || !bmi || !nutritionStatus) {
      scrollToFirstError();
      return;
    }

    setSaving(true);
    const timestamp = new Date().toISOString();
    
    const assessment: HealthAssessment = {
      assessment_id: createId(),
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
      setWeight('');
      setHeight('');
      setAssessmentDate(today());
      setResidentId('');
      setResident(null);
      await onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Health assessment was not saved.');
      scrollToFirstError();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{t('Assessment')}</p>
          <h2>{t('Health Assessment')}</h2>
        </div>
        <Badge label={t(hasIndividuals ? 'Ready' : 'Needs Profile')} tone={hasIndividuals ? 'success' : 'warning'} />
      </div>
      <form className="stack" onSubmit={handleSubmit}>
        {formError ? <p className="form-alert" role="alert"><Icon name="warning" size={18} />{formError}</p> : null}
        
        <IndividualSearch
          selectedResidentId={residentId}
          onChange={(nextId, person) => {
            setResidentId(nextId);
            setResident(person);
          }}
          error={showValidation && !residentId ? t('Select a resident.') : undefined}
        />
        
        {!hasIndividuals ? <p className="form-hint">{t('Register a household before recording a health assessment.')}</p> : null}
        
        <FormField 
          label={t('Assessment Date')}
          type="date" 
          max={today()} 
          value={assessmentDate} 
          onChange={(event) => setAssessmentDate(event.target.value)} 
          required 
          error={showValidation && !assessmentDate ? t('Assessment date is required.') : undefined}
        />
        <div className="field-row">
          <FormField 
            label={t('Weight (kg)')}
            type="number" 
            min={WEIGHT_KG_RANGE.min}
            max={WEIGHT_KG_RANGE.max}
            step="0.1"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            required
            error={showValidation && !isMeasurementInRange(weight, WEIGHT_KG_RANGE) ? t('Enter a weight from 1 to 300 kg.') : undefined}
          />
          <FormField 
            label={t('Height (cm)')}
            type="number" 
            min={HEIGHT_CM_RANGE.min}
            max={HEIGHT_CM_RANGE.max}
            step="0.1"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            required
            error={showValidation && !isMeasurementInRange(height, HEIGHT_CM_RANGE) ? t('Enter a height from 30 to 250 cm.') : undefined}
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
            {t(saving ? 'Saving Offline...' : 'Save Assessment')}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}

// The numeric readout is authoritative; the scale is a faster second read of the same answer — safe to hide from screen readers.
function BmiRail({ bmi, status }: { bmi: number | null; status: NutritionStatus | null }) {
  const { t } = useBhwLanguage();

  return (
    <section className="bmi-rail">
      <div className="bmi-readout">
        <p className="eyebrow">{t('Body mass index')}</p>
        <strong>{bmi ? bmi.toFixed(1) : '--'}</strong>
        <output className={`bmi-verdict${status ? ` bmi-verdict-${status}` : ''}`}>
          {status ? titleCase(status) : t('Enter weight and height')}
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
