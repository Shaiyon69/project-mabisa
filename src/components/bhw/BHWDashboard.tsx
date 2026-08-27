import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LocalSnapshot } from '../../app/mabisaData';
import type { Individual } from '../../types/database';
import { formatDate, titleCase } from '../../lib/utils';
import { Badge } from '../common/Badge';
import { Card } from '../common/Card';
import { Icon } from '../common/Icon';
import { EmptyState } from '../common/StateMessage';
import { SyncStatusCard } from './SyncStatusCard';
import { readLocalIndividuals } from '../../services/localDatabase';
import { useBhwLanguage } from '../../app/bhwLanguage';
import type { SyncStatus } from '../../services/syncService';

type BHWDashboardProps = {
  snapshot: LocalSnapshot;
  isOnline: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncAt: string | null;
  syncingManually: boolean;
  onManualSync: () => Promise<void>;
  onRetryDeadLetters: () => Promise<void>;
};

export function BHWDashboard({
  snapshot,
  isOnline,
  syncStatus,
  syncError,
  lastSyncAt,
  syncingManually,
  onManualSync,
  onRetryDeadLetters,
}: BHWDashboardProps) {
  const { t } = useBhwLanguage();
  // 1. Replaced the useMemo slice with a local state for our SQLite query
  const [latestIndividuals, setLatestIndividuals] = useState<Individual[]>([]);

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
        syncError={syncError}
        lastSyncAt={lastSyncAt}
        pendingQueueCount={snapshot.pendingQueueCount}
        deadLetterEntries={snapshot.deadLetterEntries}
        syncingManually={syncingManually}
        onManualSync={onManualSync}
        onRetryDeadLetters={onRetryDeadLetters}
      />

      <section className="metric-grid" aria-label="BHW metrics">
        <Metric label={t('Households')} value={snapshot.householdCount} detail={t('Registered dwellings')} tone="blue" />
        {/* The one metric with somewhere to go. There is no sixth slot on the
            bottom nav, so the registry is reached from the count of it. */}
        <Metric
          label={t('Individuals')}
          value={snapshot.individualCount}
          detail={t('Local profiles')}
          tone="green"
          to="/bhw/residents"
        />
        <Metric label={t('Assessments')} value={snapshot.assessments.length} detail={t('Health records')} tone="amber" />
        <Metric label={t('Released')} value={snapshot.disbursements.length} detail={t('Supply logs')} tone="red" />
      </section>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('BHW workflow')}</p>
            <h2>{t('Recent Profiles')}</h2>
          </div>
          <Badge label={t(snapshot.pendingQueueCount ? 'Pending Sync' : 'Saved Offline')} tone={snapshot.pendingQueueCount ? 'warning' : 'success'} />
        </div>

        {latestIndividuals.length ? (
          <ul className="compact-list resident-list">
            {latestIndividuals.map((person) => (
              <li key={person.resident_id}>
                <Link to={`/bhw/residents/${person.resident_id}`}>
                  <span>{person.first_name} {person.last_name} {person.is_household_head ? '(Head)' : ''}</span>
                  <small>
                    {titleCase(person.sex)}
                  </small>
                  <Icon name="chevron" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('No local profiles yet')} text={t('Register a household to start the offline-first BHW workflow.')} />
        )}
      </Card>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('Recent checks')}</p>
            <h2>{t('Health Assessments')}</h2>
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
          <EmptyState title={t('No assessments yet')} text={t('Saved health assessments will appear here.')} />
        )}
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
  to,
}: {
  label: string;
  value: number;
  detail: string;
  tone: 'blue' | 'green' | 'amber' | 'red';
  /** Where the tile leads, when it leads anywhere. A count with no screen behind it stays a plain div. */
  to?: string;
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );
  const className = `metric metric-${tone}${to ? ' metric-link' : ''}`;

  return to ? (
    <Link className={className} to={to}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
