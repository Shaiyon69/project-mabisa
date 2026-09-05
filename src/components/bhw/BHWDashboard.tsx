import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LocalSnapshot } from '../../app/mabisaData';
import type { Individual } from '../../types/database';
import { formatDate, logDev, titleCase } from '../../lib/utils';
import { Badge } from '../common/Badge';
import { Card } from '../common/Card';
import { Icon } from '../common/Icon';
import { EmptyState, ErrorState } from '../common/StateMessage';
import { SyncStatusCard } from './SyncStatusCard';
import { readLocalIndividuals } from '../../services/localDatabase';
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
  onSignInAgain: () => Promise<void>;
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
  onSignInAgain,
}: BHWDashboardProps) {
  // The five most recent residents, read from SQLite rather than sliced off the snapshot.
  const [latestIndividuals, setLatestIndividuals] = useState<Individual[]>([]);
  const [readFailed, setReadFailed] = useState(false);

  // Keyed on the whole snapshot, not its resident count: a correction to someone
  // already on file leaves the count alone, and this list would keep showing the
  // row as it read before the edit.
  useEffect(() => {
    let current = true;

    readLocalIndividuals({ limit: 5, orderBy: 'recent' })
      .then((rows) => {
        if (current) {
          setLatestIndividuals(rows);
          setReadFailed(false);
        }
      })
      .catch((error: unknown) => {
        logDev('Recent residents read failed', error instanceof Error ? error.message : error);

        if (current) {
          setReadFailed(true);
        }
      });

    return () => {
      current = false;
    };
  }, [snapshot]);


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
        onSignInAgain={onSignInAgain}
      />

      <section className="metric-grid" aria-label="BHW metrics">
        <Metric label="Households" value={snapshot.householdCount} detail="Houses recorded" tone="blue" />
        {/* The one metric with somewhere to go. There is no sixth slot on the
            bottom nav, so the registry is reached from the count of it. */}
        <Metric
          label="Residents"
          value={snapshot.individualCount}
          detail="People on this phone"
          tone="green"
          to="/bhw/residents"
        />
        <Metric label="Health checks" value={snapshot.assessmentCount} detail="Checks recorded" tone="amber" />
        <Metric label="Supplies given" value={snapshot.disbursementCount} detail="Items handed out" tone="red" />
      </section>

      {/* What this health worker is still carrying. The numbers were already on the
          device — the pull fetches `bhw_item_stock`, which is her allocations minus
          her releases — but until this card the only place they appeared was the
          item dropdown inside the release form, one item at a time. "Do I have
          enough for today" is a question asked before leaving the house, not
          halfway through a form for a resident already standing there.

          Lowest count first, so whatever is about to run out is at the top. An item
          she has released down to zero still shows, because that is precisely what
          she needs to know; an item never allocated to her is absent from the view
          entirely and so cannot appear here. */}
      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">On this phone</p>
            <h2>My Supplies</h2>
          </div>
          {/* Stock only moves when the barangay office allocates or this phone
              syncs, so the age of the figure is part of the figure. */}
          <Badge
            label={lastSyncAt ? `Updated ${formatDate(lastSyncAt)}` : 'Not updated yet'}
            tone={lastSyncAt ? 'success' : 'warning'}
          />
        </div>

        {snapshot.inventoryItems.length ? (
          <ul className="compact-list">
            {[...snapshot.inventoryItems]
              .sort((a, b) => a.current_stock - b.current_stock || a.item_name.localeCompare(b.item_name))
              .map((item) => (
                <li key={item.item_id}>
                  <span>
                    {item.current_stock} — {item.item_name}
                  </span>
                  <small>{titleCase(item.type)}</small>
                </li>
              ))}
          </ul>
        ) : (
          <EmptyState
            title="No supplies given to you yet"
            text="The barangay office hands out stock to each health worker. Get the latest once you have signal to check again."
          />
        )}
      </Card>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recently added</p>
            <h2>Recent Residents</h2>
          </div>
          <Badge label={snapshot.pendingQueueCount ? 'Waiting to send' : 'All sent'} tone={snapshot.pendingQueueCount ? 'warning' : 'success'} />
        </div>

        {latestIndividuals.length ? (
          <ul className="compact-list resident-list">
            {latestIndividuals.map((person) => (
              <li key={person.resident_id}>
                <Link to={`/bhw/residents/${person.resident_id}`}>
                  <span>
                    {person.last_name}, {person.first_name}
                    {person.is_household_head ? ' (Head)' : ''}
                  </span>
                  <small>
                    {titleCase(person.sex)}
                  </small>
                  <Icon name="chevron" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        ) : readFailed ? (
          <ErrorState title="Could not open this phone's records" text="Your records are still saved. Open this screen again to try once more." />
        ) : (
          <EmptyState title="No residents yet" text="Register a household to begin. It saves on this phone even with no signal." />
        )}
      </Card>

      <Card className="list-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recent checks</p>
            <h2>Health Checks</h2>
          </div>
        </div>
        {snapshot.latestAssessments.length ? (
          <ul className="compact-list">
            {snapshot.latestAssessments.map((assessment) => (
              <li key={assessment.assessment_id}>
                <span>{titleCase(assessment.nutrition_status)}</span>
                <small>
                  {assessment.bmi.toFixed(2)} BMI • {formatDate(assessment.assessment_date)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No health checks yet" text="Checks you save will appear here." />
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
