import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HealthAssessment,
  InventoryItem,
  NutritionStatus,
  Resident,
  ResidentSex,
  SupplyDisbursement,
} from '../types/database';
import { useBackgroundSync } from '../hooks/useBackgroundSync';
import {
  readLocalHealthAssessments,
  readLocalInventoryItems,
  readLocalResidents,
  readLocalSupplyDisbursements,
  readSyncQueue,
  saveHealthAssessmentLocally,
  saveInventoryItemLocally,
  saveResidentLocally,
  saveSupplyDisbursementLocally,
} from '../services/localDatabase';

type DashboardProps = {
  bhwId: string;
  logout: () => Promise<void>;
};

type ActiveView = 'dashboard' | 'resident' | 'assessment' | 'disbursement';

type LocalSnapshot = {
  residents: Resident[];
  assessments: HealthAssessment[];
  inventoryItems: InventoryItem[];
  disbursements: SupplyDisbursement[];
  pendingQueueCount: number;
};

const emptySnapshot: LocalSnapshot = {
  residents: [],
  assessments: [],
  inventoryItems: [],
  disbursements: [],
  pendingQueueCount: 0,
};

export default function Dashboard({ bhwId, logout }: DashboardProps) {
  const backgroundSync = useBackgroundSync();
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [snapshot, setSnapshot] = useState<LocalSnapshot>(emptySnapshot);
  const [message, setMessage] = useState<string | null>(null);

  const refreshLocalData = useCallback(async () => {
    const [residents, assessments, inventoryItems, disbursements, queue] = await Promise.all([
      readLocalResidents(),
      readLocalHealthAssessments(),
      readLocalInventoryItems(),
      readLocalSupplyDisbursements(),
      readSyncQueue(),
    ]);

    setSnapshot({
      residents,
      assessments,
      inventoryItems,
      disbursements,
      pendingQueueCount: queue.length,
    });
  }, []);

  useEffect(() => {
    void refreshLocalData();
  }, [refreshLocalData, backgroundSync.lastResult]);

  const latestResidents = useMemo(() => snapshot.residents.slice(0, 4), [snapshot.residents]);

  async function handleManualSync() {
    const result = await backgroundSync.runSync();
    await refreshLocalData();
    setMessage(result.status === 'synced' ? `Synced ${result.processed} queued change(s).` : result.errorMessage);
  }

  return (
    <main className="mobile-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">BHW Console</p>
          <h1>MABISA Mobile</h1>
        </div>
        <button className="ghost-button" type="button" onClick={logout}>
          Logout
        </button>
      </header>

      <nav className="mobile-tabs" aria-label="Mobile sections">
        <button type="button" className={activeView === 'dashboard' ? 'active' : ''} onClick={() => setActiveView('dashboard')}>
          Status
        </button>
        <button type="button" className={activeView === 'resident' ? 'active' : ''} onClick={() => setActiveView('resident')}>
          Resident
        </button>
        <button type="button" className={activeView === 'assessment' ? 'active' : ''} onClick={() => setActiveView('assessment')}>
          Health
        </button>
        <button type="button" className={activeView === 'disbursement' ? 'active' : ''} onClick={() => setActiveView('disbursement')}>
          Supply
        </button>
      </nav>

      {message ? <p className="notice">{message}</p> : null}

      {activeView === 'dashboard' ? (
        <DashboardPanel
          latestResidents={latestResidents}
          snapshot={snapshot}
          syncStatus={backgroundSync.status}
          isOnline={backgroundSync.isOnline}
          onManualSync={handleManualSync}
        />
      ) : null}

      {activeView === 'resident' ? (
        <ResidentForm
          bhwId={bhwId}
          onSaved={async () => {
            await refreshLocalData();
            setMessage('Resident profile saved locally and queued for sync.');
            setActiveView('dashboard');
          }}
        />
      ) : null}

      {activeView === 'assessment' ? (
        <HealthAssessmentForm
          residents={snapshot.residents}
          onSaved={async () => {
            await refreshLocalData();
            setMessage('Health assessment saved locally and queued for sync.');
            setActiveView('dashboard');
          }}
        />
      ) : null}

      {activeView === 'disbursement' ? (
        <SupplyDisbursementForm
          residents={snapshot.residents}
          inventoryItems={snapshot.inventoryItems}
          onSaved={async () => {
            await refreshLocalData();
            setMessage('Supply disbursement saved locally and queued for sync.');
            setActiveView('dashboard');
          }}
        />
      ) : null}
    </main>
  );
}

function DashboardPanel({
  latestResidents,
  snapshot,
  syncStatus,
  isOnline,
  onManualSync,
}: {
  latestResidents: Resident[];
  snapshot: LocalSnapshot;
  syncStatus: string;
  isOnline: boolean;
  onManualSync: () => Promise<void>;
}) {
  return (
    <section className="screen-panel">
      <div className="status-strip">
        <div>
          <span>Connection</span>
          <strong>{isOnline ? 'Online' : 'Offline'}</strong>
        </div>
        <div>
          <span>Sync</span>
          <strong>{syncStatus}</strong>
        </div>
        <div>
          <span>Queue</span>
          <strong>{snapshot.pendingQueueCount}</strong>
        </div>
      </div>

      <button className="primary-button" type="button" onClick={onManualSync}>
        Sync Now
      </button>

      <div className="metric-grid">
        <Metric label="Residents" value={snapshot.residents.length} />
        <Metric label="Assessments" value={snapshot.assessments.length} />
        <Metric label="Inventory" value={snapshot.inventoryItems.length} />
        <Metric label="Released" value={snapshot.disbursements.length} />
      </div>

      <section className="list-section">
        <h2>Recent Residents</h2>
        {latestResidents.length ? (
          <ul className="compact-list">
            {latestResidents.map((resident) => (
              <li key={resident.resident_id}>
                <span>{resident.name}</span>
                <small>{resident.address}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No local resident profiles yet.</p>
        )}
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ResidentForm({ bhwId, onSaved }: { bhwId: string; onSaved: () => Promise<void> }) {
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
    <section className="screen-panel">
      <h2>New Resident Profile</h2>
      <form className="stack" onSubmit={handleSubmit}>
        <label>
          <span>Full Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          <span>Birthdate</span>
          <input type="date" value={birthdate} onChange={(event) => setBirthdate(event.target.value)} required />
        </label>
        <label>
          <span>Sex</span>
          <select value={sex} onChange={(event) => setSex(event.target.value as ResidentSex)}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
        <label>
          <span>Address</span>
          <textarea value={address} onChange={(event) => setAddress(event.target.value)} required />
        </label>
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? 'Saving' : 'Save Resident'}
        </button>
      </form>
    </section>
  );
}

function HealthAssessmentForm({ residents, onSaved }: { residents: Resident[]; onSaved: () => Promise<void> }) {
  const [residentId, setResidentId] = useState('');
  const [assessmentDate, setAssessmentDate] = useState(today());
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [saving, setSaving] = useState(false);
  const bmi = calculateBmi(Number(weight), Number(height));
  const nutritionStatus = getNutritionStatus(bmi);

  useEffect(() => {
    if (!residentId && residents[0]) {
      setResidentId(residents[0].resident_id);
    }
  }, [residentId, residents]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!bmi || !nutritionStatus) {
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

    await saveHealthAssessmentLocally(assessment);
    setWeight('');
    setHeight('');
    setAssessmentDate(today());
    setSaving(false);
    await onSaved();
  }

  return (
    <section className="screen-panel">
      <h2>Health Assessment</h2>
      <form className="stack" onSubmit={handleSubmit}>
        <label>
          <span>Resident</span>
          <select value={residentId} onChange={(event) => setResidentId(event.target.value)} required>
            {residents.map((resident) => (
              <option key={resident.resident_id} value={resident.resident_id}>
                {resident.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Assessment Date</span>
          <input type="date" value={assessmentDate} onChange={(event) => setAssessmentDate(event.target.value)} required />
        </label>
        <div className="field-row">
          <label>
            <span>Weight kg</span>
            <input min="1" step="0.1" type="number" value={weight} onChange={(event) => setWeight(event.target.value)} required />
          </label>
          <label>
            <span>Height cm</span>
            <input min="1" step="0.1" type="number" value={height} onChange={(event) => setHeight(event.target.value)} required />
          </label>
        </div>
        <div className="computed-panel">
          <span>BMI</span>
          <strong>{bmi ? bmi.toFixed(2) : '0.00'}</strong>
          <span>{nutritionStatus ?? 'Waiting for measurements'}</span>
        </div>
        <button className="primary-button" type="submit" disabled={saving || !residents.length}>
          {saving ? 'Saving' : 'Save Assessment'}
        </button>
      </form>
    </section>
  );
}

function SupplyDisbursementForm({
  residents,
  inventoryItems,
  onSaved,
}: {
  residents: Resident[];
  inventoryItems: InventoryItem[];
  onSaved: () => Promise<void>;
}) {
  const [residentId, setResidentId] = useState('');
  const [itemId, setItemId] = useState('');
  const [disbursementDate, setDisbursementDate] = useState(today());
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedItem = inventoryItems.find((item) => item.item_id === itemId) ?? null;

  useEffect(() => {
    if (!residentId && residents[0]) {
      setResidentId(residents[0].resident_id);
    }

    if (!itemId && inventoryItems[0]) {
      setItemId(inventoryItems[0].item_id);
    }
  }, [inventoryItems, itemId, residentId, residents]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedItem) {
      return;
    }

    const releasedQuantity = Number(quantity);
    if (releasedQuantity <= 0 || releasedQuantity > selectedItem.current_stock) {
      return;
    }

    setSaving(true);
    const timestamp = new Date().toISOString();
    const disbursement: SupplyDisbursement = {
      log_id: createId(),
      item_id: itemId,
      resident_id: residentId,
      disbursement_date: disbursementDate,
      quantity: releasedQuantity,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const updatedItem: InventoryItem = {
      ...selectedItem,
      current_stock: selectedItem.current_stock - releasedQuantity,
      updated_at: timestamp,
    };

    await saveSupplyDisbursementLocally(disbursement);
    await saveInventoryItemLocally(updatedItem, 'UPDATE');
    setQuantity('');
    setDisbursementDate(today());
    setSaving(false);
    await onSaved();
  }

  return (
    <section className="screen-panel">
      <h2>Log Supply Disbursement</h2>
      <form className="stack" onSubmit={handleSubmit}>
        <label>
          <span>Resident</span>
          <select value={residentId} onChange={(event) => setResidentId(event.target.value)} required>
            {residents.map((resident) => (
              <option key={resident.resident_id} value={resident.resident_id}>
                {resident.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Supply Item</span>
          <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
            {inventoryItems.map((item) => (
              <option key={item.item_id} value={item.item_id}>
                {item.item_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Date Released</span>
          <input type="date" value={disbursementDate} onChange={(event) => setDisbursementDate(event.target.value)} required />
        </label>
        <label>
          <span>Quantity</span>
          <input
            min="1"
            max={selectedItem?.current_stock ?? 1}
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
        </label>
        <p className="muted">Available stock: {selectedItem?.current_stock ?? 0}</p>
        <button className="primary-button" type="submit" disabled={saving || !residents.length || !inventoryItems.length}>
          {saving ? 'Saving' : 'Save Disbursement'}
        </button>
      </form>
    </section>
  );
}

function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (weightKg <= 0 || heightCm <= 0) {
    return null;
  }

  const heightMeters = heightCm / 100;
  return Number((weightKg / (heightMeters * heightMeters)).toFixed(2));
}

function getNutritionStatus(bmi: number | null): NutritionStatus | null {
  if (!bmi) {
    return null;
  }

  if (bmi < 18.5) {
    return 'underweight';
  }

  if (bmi < 25) {
    return 'normal';
  }

  if (bmi < 30) {
    return 'overweight';
  }

  return 'obese';
}

function createId(): string {
  return crypto.randomUUID();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
