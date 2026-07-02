import { useState } from 'react';
import type { Resident, ResidentSex } from '../../types/database';
import { createId } from '../../lib/utils';
import { saveResidentLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { FormActions, FormField, SelectField, TextAreaField } from '../common/FormField';

type ResidentFormProps = {
  bhwId: string;
  onSaved: () => Promise<void>;
};

export function ResidentForm({ bhwId, onSaved }: ResidentFormProps) {
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [sex, setSex] = useState<ResidentSex>('female');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const timestamp = new Date().toISOString();
    const resident: Resident = {
      resident_id: createId(),
      name: name.trim(),
      birthdate,
      sex,
      address: address.trim(),
      assigned_bhw: bhwId,
      created_at: timestamp,
      updated_at: timestamp,
    };

    try {
      await saveResidentLocally(resident);
      setName('');
      setBirthdate('');
      setSex('female');
      setAddress('');
      await onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Resident profile was not saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Resident profiling</p>
          <h2>New Resident Profile</h2>
        </div>
        <Badge label="Saved Offline" tone="success" />
      </div>
      <form className="stack" onSubmit={handleSubmit}>
        {formError ? <p className="form-hint">{formError}</p> : null}
        <FormField label="Full Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Juan Dela Cruz" required />
        <div className="field-row">
          <FormField label="Birthdate" type="date" value={birthdate} onChange={(event) => setBirthdate(event.target.value)} required />
          <SelectField label="Sex" value={sex} onChange={(event) => setSex(event.target.value as ResidentSex)}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </SelectField>
        </div>
        <TextAreaField
          label="Purok / Address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Purok, street, or household landmark"
          required
        />
        <FormActions>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving Offline' : 'Save Resident'}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
