import { useEffect, useMemo, useState } from 'react';
import type { LocalSnapshot } from '../../app/mabisaData';
import type { Individual } from '../../types/database';
import { formatDate, titleCase } from '../../lib/utils';
import { Badge } from '../common/Badge';
import { Card } from '../common/Card';
import { EmptyState } from '../common/StateMessage';
import { SyncStatusCard } from './SyncStatusCard';
import { readLocalIndividuals } from '../../services/localDatabase';

type BHWDashboardProps = {
  snapshot: LocalSnapshot;
  isOnline: boolean;
  syncStatus: string;
  syncingManually: boolean;
  onManualSync: () => Promise<void>;
};

export function BHWDashboard({ snapshot, isOnline, syncStatus, syncingManually, onManualSync }: BHWDashboardProps) {
  // 1. Replaced the useMemo slice with a local state for our SQLite query
  const [latestIndividuals, setLatestIndividuals] = useState<Individual[]>([]);

  // 2. Fetch a tiny chunk of individuals directly from the local DB for the list.
  // We re-run this anytime the individualCount changes (e.g., when a new one is saved).
  useEffect(() => {
    readLocalIndividuals({ limit: 5 })
      .then(setLatestIndividuals)
      .catch(console.error);
  }, [snapshot.individualCount]);

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
        {/* 3. Updated metrics to use the new lightweight integer counts */}
        <Metric label="Households" value={snapshot.householdCount} detail="Registered dwellings" tone="blue" />
        <Metric label="Individuals" value={snapshot.individualCount} detail="Local profiles" tone="green" />
        <Metric label="Assessments" value={snapshot.assessments.length} detail="Health records" tone="amber" />
        <Metric label="Released" value={snapshot.disbursements.length} detail="Supply logs" tone="red" />
      </section>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">BHW workflow</p>
            <h2>Recent Profiles</h2>
          </div>
          <Badge label={snapshot.pendingQueueCount ? 'Pending Sync' : 'Saved Offline'} tone={snapshot.pendingQueueCount ? 'warning' : 'success'} />
        </div>
        
        {latestIndividuals.length ? (
          <ul className="compact-list">
            {latestIndividuals.map((person) => (
              <li key={person.resident_id}>
                <span>{person.first_name} {person.last_name} {person.is_household_head ? '(Head)' : ''}</span>
                <small>
                  {titleCase(person.sex)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No local profiles yet" text="Register a household to start the offline-first BHW workflow." />
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