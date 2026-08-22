import { formatDate } from '../../lib/utils';
import { Button } from '../common/Button';
import { FormField } from '../common/FormField';
import type { AdminFilters, AdminSnapshot } from '../../services/adminData';

type AdminFilterBarProps = {
  filters: AdminFilters;
  onChange: (filters: AdminFilters) => void;
  onRefresh: () => void;
  loading: boolean;
  snapshot: AdminSnapshot;
};

/**
 * The period control, plus the freshness line FR-06 asks for.
 *
 * Native `<input type="date">` on both ends: the browser already has a date
 * picker that is localized, keyboard-accessible and understood by the officer
 * using it. A blank end date would silently widen the report, so an empty value
 * is ignored rather than written through.
 */
export function AdminFilterBar({ filters, onChange, onRefresh, loading, snapshot }: AdminFilterBarProps) {
  return (
    <div className="admin-filter-bar">
      <FormField
        type="date"
        label="Period from"
        value={filters.from}
        max={filters.to}
        onChange={(event) => event.target.value && onChange({ ...filters, from: event.target.value })}
      />
      <FormField
        type="date"
        label="Period to"
        value={filters.to}
        min={filters.from}
        onChange={(event) => event.target.value && onChange({ ...filters, to: event.target.value })}
      />
      <div className="admin-filter-actions">
        <Button variant="secondary" onClick={onRefresh} disabled={loading}>
          {loading ? 'Reading…' : 'Refresh'}
        </Button>
        <DataFreshness snapshot={snapshot} loading={loading} />
      </div>
    </div>
  );
}

function DataFreshness({ snapshot, loading }: { snapshot: AdminSnapshot; loading: boolean }) {
  if (loading) {
    return <small className="muted">Reading the central database…</small>;
  }

  // The epoch stamp is what `emptyAdminSnapshot` carries, so it means "no read
  // has completed" rather than "read in 1970".
  if (snapshot.fetchedAt === new Date(0).toISOString()) {
    return <small className="muted">Not read yet.</small>;
  }

  return (
    <small className="muted">
      Central data read {new Date(snapshot.fetchedAt).toLocaleTimeString()}.{' '}
      {snapshot.newestRecordAt
        ? `Newest synced record ${formatDate(snapshot.newestRecordAt)}.`
        : 'No synced records in range.'}
    </small>
  );
}

/**
 * The caption under a summary, so no number on this portal is readable without
 * the period and filters that produced it (FR-06 acceptance).
 */
export function SummaryContext({ filters, extra }: { filters: AdminFilters; extra?: string }) {
  return (
    <p className="summary-context">
      Period {formatDate(filters.from)} – {formatDate(filters.to)} · Filters: {extra ?? 'none beyond the period'}
    </p>
  );
}
