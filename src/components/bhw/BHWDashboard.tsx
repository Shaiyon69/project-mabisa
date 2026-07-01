import { useMemo } from 'react';
import type { LocalSnapshot } from '../../app/mabisaData';
import { formatDate, titleCase } from '../../lib/utils';
import { Badge } from '../common/Badge';
import { Card } from '../common/Card';
import { EmptyState } from '../common/EmptyState';
import { SyncStatusCard } from './SyncStatusCard';

type BHWDashboardProps = {
  snapshot: LocalSnapshot;
  isOnline: boolean;
  syncStatus: string;
  syncingManually: boolean;
  onManualSync: () => Promise<void>;
};

export function BHWDashboard({ snapshot, isOnline, syncStatus, syncingManually, onManualSync }: BHWDashboardProps) {
  const latestResidents = useMemo(() => snapshot.residents.slice(0, 5), [snapshot.residents]);
  const latestAssessments = useMemo(() => snapshot.assessments.slice(0, 3), [snapshot.assessments]);

  return (
    <div className="dashboard-grid">
      <SyncStatusCard
        isOnline={isOnline}
        syncStatus={syncStatus}
        pendingQueueCount={snapshot.pendingQueueCount}
        syncingManually={syncingManually}
        onManualSync={onManualSync}
      />

      <section className="metric-grid" aria-label="BHW metrics">
        <Metric label="Residents" value={snapshot.residents.length} detail="Local profiles" tone="blue" />
        <Metric label="Assessments" value={snapshot.assessments.length} detail="Health records" tone="green" />
        <Metric label="Inventory" value={snapshot.inventoryItems.length} detail="Tracked items" tone="amber" />
        <Metric label="Released" value={snapshot.disbursements.length} detail="Supply logs" tone="red" />
      </section>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">BHW workflow</p>
            <h2>Recent Residents</h2>
          </div>
          <Badge label={snapshot.pendingQueueCount ? 'Pending Sync' : 'Saved Offline'} tone={snapshot.pendingQueueCount ? 'warning' : 'success'} />
        </div>
        {latestResidents.length ? (
          <ul className="compact-list">
            {latestResidents.map((resident) => (
              <li key={resident.resident_id}>
                <span>{resident.name}</span>
                <small>
                  {titleCase(resident.sex)} • {resident.address}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No local resident profiles yet" text="Register a resident to start the offline-first BHW workflow." />
        )}
      </Card>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recent checks</p>
            <h2>Health Assessments</h2>
          </div>
        </div>
        {latestAssessments.length ? (
          <ul className="compact-list">
            {latestAssessments.map((assessment) => (
              <li key={assessment.assessment_id}>
                <span>{titleCase(assessment.nutrition_status)}</span>
                <small>
                  {assessment.bmi.toFixed(2)} BMI • {formatDate(assessment.assessment_date)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No assessments yet" text="Saved health assessments will appear here." />
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: 'blue' | 'green' | 'amber' | 'red' }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
