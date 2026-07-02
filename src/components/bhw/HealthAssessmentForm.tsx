import { useState } from 'react';
import type { HealthAssessment, Resident } from '../../types/database';
import { calculateBmi, createId, getNutritionStatus, today } from '../../lib/utils';
import { saveHealthAssessmentLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField } from '../common/FormField';
import { ResidentSearch } from './ResidentSearch';

type HealthAssessmentFormProps = {
  residents: Resident[];
  onSaved: () => Promise<void>;
};

export function HealthAssessmentForm({ residents, onSaved }: HealthAssessmentFormProps) {
  const [residentId, setResidentId] = useState('');
  const [assessmentDate, setAssessmentDate] = useState(today());
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const selectedResidentId = residentId || residents[0]?.resident_id || '';
  const bmi = calculateBmi(Number(weight), Number(height));
  const nutritionStatus = getNutritionStatus(bmi);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!bmi || !nutritionStatus) {
      return;
    }

    setSaving(true);
    setFormError(null);
    const timestamp = new Date().toISOString();
    const assessment: HealthAssessment = {
      assessment_id: createId(),
      resident_id: selectedResidentId,
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
          <p className="eyebrow">Assessment</p>
          <h2>Health Assessment</h2>
        </div>
        <Badge label={residents.length ? 'Ready' : 'Needs Resident'} tone={residents.length ? 'success' : 'warning'} />
      </div>
      <form className="stack" onSubmit={handleSubmit}>
        {formError ? <p className="form-hint">{formError}</p> : null}
        <ResidentSearch residents={residents} selectedResidentId={selectedResidentId} onChange={setResidentId} />
        {!residents.length ? <p className="form-hint">Register a resident before recording a health assessment.</p> : null}
        <FormField label="Assessment Date" type="date" value={assessmentDate} onChange={(event) => setAssessmentDate(event.target.value)} required />
        <div className="field-row">
          <FormField label="Weight kg" min="1" step="0.1" type="number" value={weight} onChange={(event) => setWeight(event.target.value)} required />
          <FormField label="Height cm" min="1" step="0.1" type="number" value={height} onChange={(event) => setHeight(event.target.value)} required />
        </div>
        <div className="computed-panel">
          <span>BMI</span>
          <strong>{bmi ? bmi.toFixed(2) : '0.00'}</strong>
          <Badge label={nutritionStatus ?? 'Waiting for measurements'} tone={nutritionStatus === 'normal' ? 'success' : nutritionStatus ? 'warning' : 'info'} />
        </div>
        <FormActions>
          <Button type="submit" disabled={saving || !residents.length}>
            {saving ? 'Saving Offline' : 'Save Assessment'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
