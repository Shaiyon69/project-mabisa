import { useState } from 'react';
import type { Resident, ResidentSex } from '../../types/database';
import { createId } from '../../lib/utils';
import { saveResidentLocally } from '../../services/localDatabase';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Input } from '../common/Input';
import { Select } from '../common/Select';

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);

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

    await saveResidentLocally(resident);
    setName('');
    setBirthdate('');
    setSex('female');
    setAddress('');
    setSaving(false);
    await onSaved();
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
        <Input label="Full Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Juan Dela Cruz" required />
        <div className="field-row">
          <Input label="Birthdate" type="date" value={birthdate} onChange={(event) => setBirthdate(event.target.value)} required />
          <Select label="Sex" value={sex} onChange={(event) => setSex(event.target.value as ResidentSex)}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </div>
        <label>
          <span>Purok / Address</span>
          <textarea value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Purok, street, or household landmark" required />
        </label>
        <div className="sticky-actions">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving Offline' : 'Save Resident'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
