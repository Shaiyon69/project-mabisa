import { useState } from 'react';
import type { HealthAssessment, NutritionStatus } from '../../types/database';
import { calculateBmi, createId, getNutritionStatus, titleCase, today } from '../../lib/utils';
import { saveHealthAssessmentLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField } from '../common/FormField';
import { IndividualSearch } from './IndividualSearch';
import { Icon } from '../common/Icon';
import { useBhwLanguage } from '../../app/BhwLanguageContext';

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
  const { t } = useBhwLanguage();
  const [residentId, setResidentId] = useState('');
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
    (!weight || !height || !bmi || !nutritionStatus) && 'valid weight and height',
  ].filter(Boolean) as string[];
  const isFormReady = missingRequirements.length === 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidation(true);
    setFormError(null);

    if (!isFormReady || !bmi || !nutritionStatus) {
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
      await onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Health assessment was not saved.');
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
        
        <IndividualSearch selectedResidentId={residentId} onChange={setResidentId} error={showValidation && !residentId ? t('Select a resident.') : undefined} />
        
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
            min="1" 
            max="300" 
            step="0.1" 
            value={weight} 
            onChange={(event) => setWeight(event.target.value)} 
            required 
            error={showValidation && (!weight || Number(weight) < 1 || Number(weight) > 300) ? t('Enter a weight from 1 to 300 kg.') : undefined}
          />
          <FormField 
            label={t('Height (cm)')}
            type="number" 
            min="30"  
            max="250" 
            step="0.1" 
            value={height} 
            onChange={(event) => setHeight(event.target.value)} 
            required 
            error={showValidation && (!height || Number(height) < 30 || Number(height) > 250) ? t('Enter a height from 30 to 250 cm.') : undefined}
          />
        </div>
        <BmiRail bmi={bmi} status={nutritionStatus} />
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

// The reading, on the scale that produced it. The numeric readout is the
// authoritative answer; the scale is a second, faster way to reach the same one,
// which is what makes it safe to hide from screen readers.
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
