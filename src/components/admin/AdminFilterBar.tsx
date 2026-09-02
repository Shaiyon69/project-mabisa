import { useState } from 'react';
import { formatDate } from '../../lib/utils';
import { Button } from '../common/Button';
import { FormField, SelectField } from '../common/FormField';
import {
  PERIOD_PRESETS,
  activePreset,
  describeScope,
  presetRange,
  type AdminFilters,
  type AdminSnapshot,
} from '../../services/adminData';
import type { UserRole } from '../../types/database';

type AdminFilterBarProps = {
  filters: AdminFilters;
  onChange: (filters: AdminFilters) => void;
  onRefresh: () => void;
  loading: boolean;
  snapshot: AdminSnapshot;
  /** Only an `admin` sees more than one barangay, so only an admin gets the picker. */
  role: UserRole | null;
};

/**
 * The scope control: which period, which barangay, and what that combination
 * actually governs.
 *
 * It used to be two bare `<input type="date">` fields labelled "Period from" and
 * "Period to", which was confusing for a reason that had nothing to do with the
 * inputs: half the numbers on the screen ignore the period entirely. Households,
 * residents and stock are running positions — a household does not stop existing
 * outside a date range — while assessments and releases are events inside it.
 * Two date fields with no statement of that read as a filter over everything.
 *
 * So the control says three things in the order they are needed: the common
 * ranges as one click each, the resolved range and scope in words, and the one
 * line naming what the range does not touch. Typing a custom range is still
 * possible and still uses the native picker — it is folded away because it is
 * the rarer act, not because it is secondary.
 *
 * All of that is folded away in turn. A scope control is read far more often
 * than it is changed: the officer sets a range once and then reads five panels
 * against it, so five chips, two date fields, a picker and two caption lines
 * were holding a screen's worth of height to state a choice that fits on one
 * line. Collapsed, the bar *is* that line and the panels start higher; the
 * controls are one click behind it in a `<details>`, which is the browser's own
 * disclosure — no open state to keep in sync, and it works before hydration.
 */
export function AdminFilterBar({ filters, onChange, onRefresh, loading, snapshot, role }: AdminFilterBarProps) {
  const preset = activePreset(filters);
  const [open, setOpen] = useState(false);
  // Shown by default when the range matches no preset, so a custom range
  // arriving in a shared link shows the dates that produced it rather than
  // hiding them behind a control the reader has to think to open.
  const [showCustom, setShowCustom] = useState(preset === null);
  const canPickBarangay = role === 'admin' && snapshot.barangays.length > 1;
  const activeLabel = PERIOD_PRESETS.find((option) => option.id === preset)?.label ?? 'Custom range';

  return (
    <div className="admin-filter-bar">
      {/* Escape closes it, because a panel that overlays the page has to be
          dismissable without hunting for the control that opened it. */}
      <details
        className="scope-picker"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
      >
        <summary>
          {/* The summary is the caption the page used to carry on its own line:
              collapsed, the bar still says what every number below it covers. */}
          <span className="scope-value">
            {activeLabel} · {formatDate(filters.from)} – {formatDate(filters.to)} ·{' '}
            {describeScope(filters, snapshot.barangays)}
          </span>
          <span className="scope-hint" aria-hidden="true">
            Change
          </span>
        </summary>

        <div className="scope-panel">
          <div className="period-presets" role="group" aria-label="Period">
            {PERIOD_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`period-chip${preset === option.id ? ' is-active' : ''}`}
                aria-pressed={preset === option.id}
                onClick={() => {
                  onChange({ ...filters, ...presetRange(option.id) });
                  setShowCustom(false);
                  // A preset is the whole choice, so the panel has done its job.
                  // A custom range or a barangay is not: those leave it open.
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className={`period-chip${preset === null ? ' is-active' : ''}`}
              aria-expanded={showCustom}
              onClick={() => setShowCustom((showing) => !showing)}
            >
              Custom range
            </button>
          </div>

          {showCustom ? (
            <div className="period-custom">
              {/* Native `<input type="date">` on both ends: the browser already
                  has a picker that is localized, keyboard-accessible and
                  understood by the officer using it. An empty value is ignored
                  rather than written through, because a blank end date would
                  silently widen the report. */}
              <FormField
                type="date"
                label="Activity from"
                value={filters.from}
                max={filters.to}
                onChange={(event) => event.target.value && onChange({ ...filters, from: event.target.value })}
              />
              <FormField
                type="date"
                label="Activity to"
                value={filters.to}
                min={filters.from}
                onChange={(event) => event.target.value && onChange({ ...filters, to: event.target.value })}
              />
            </div>
          ) : null}

          {canPickBarangay ? (
            <SelectField
              label="Barangay"
              value={filters.barangayId ?? ''}
              onChange={(event) => onChange({ ...filters, barangayId: event.target.value || null })}
            >
              <option value="">All barangays</option>
              {snapshot.barangays.map((barangay) => (
                <option key={barangay.barangay_id} value={barangay.barangay_id}>
                  {barangay.name}
                </option>
              ))}
            </SelectField>
          ) : null}

          {/* The line the two date fields were missing. It is stated once, here,
              so the panels below can carry their period without each repeating
              the caveat. */}
          <p className="summary-context filter-caveat">
            Dates filter <strong>activity</strong> — assessments recorded and supplies released. Household, resident and
            stock figures are current totals and are not affected by the range.
          </p>
        </div>
      </details>

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
    return <small className="muted">Reading…</small>;
  }

  // The epoch stamp is what `emptyAdminSnapshot` carries, so it means "no read
  // has completed" rather than "read in 1970".
  if (snapshot.fetchedAt === new Date(0).toISOString()) {
    return <small className="muted">Not read yet.</small>;
  }

  // Two facts, not two sentences: when this screen last read the database, and
  // how recent the newest record it found is.
  return (
    <small className="muted">
      {/*
        Which area these numbers cover, stated on screen and not only on an
        export. Two roles read this dashboard and they are shown different
        totals from the same query — without the scope on the page, a barangay
        administrator seeing a smaller resident count has no way to tell a
        correctly-scoped view from a sync that has not finished.
      */}
      {snapshot.barangayLabel ? `${snapshot.barangayLabel}. ` : ''}
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
 *
 * The filter clause is only printed when there is one. "Filters: none beyond the
 * period" appeared under every summary on the portal and said, at length, that
 * there is nothing more to say — the period alone is the whole filter context.
 */
export function SummaryContext({
  filters,
  extra,
  barangays,
}: {
  filters: AdminFilters;
  extra?: string;
  /** Given, the caption names the barangay as well as the range. */
  barangays?: AdminSnapshot['barangays'];
}) {
  return (
    <p className="summary-context">
      {formatDate(filters.from)} – {formatDate(filters.to)}
      {barangays && filters.barangayId ? ` · ${describeScope(filters, barangays)}` : ''}
      {extra ? ` · ${extra}` : ''}
    </p>
  );
}
