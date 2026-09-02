import { useState } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import { Button } from '../common/Button';
import { FormField, SelectField } from '../common/FormField';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import {
  AGE_BANDS,
  FILTER_PARAMS,
  PERIOD_PRESETS,
  REPORT_SECTIONS,
  activePreset,
  describeScope,
  presetRange,
  type AdminFilters,
  type AdminSnapshot,
} from '../../services/adminData';
import { RESIDENT_STATUSES, USER_ROLES, type UserRole } from '../../types/database';

/**
 * The narrow filters the drawer can offer, each paired with the values it may
 * take. One table rather than a control per tab: every one of these is a single
 * value chosen from a closed list, so they differ only in their label and their
 * options, and a per-tab component would be seven copies of one `<select>`.
 *
 * The option lists are read off the tuples that already define these unions
 * (`RESIDENT_STATUSES`, `USER_ROLES`, `AGE_BANDS`) wherever one exists, so a
 * membership state or a role added to the database cannot go missing from the
 * picker. `sex`, `itemType` and `stockLevel` have no exported tuple to read —
 * their unions are declared inline in `types/database.ts` — so they are listed
 * here and the `satisfies` below is what keeps them honest.
 */
const FILTER_FIELDS = {
  sex: { label: 'Sex', options: ['female', 'male'] },
  ageBand: { label: 'Age band', options: AGE_BANDS.map((band) => band.label) },
  membership: { label: 'Membership', options: RESIDENT_STATUSES },
  itemType: { label: 'Item type', options: ['medicine', 'food', 'equipment', 'hygiene', 'other'] },
  stockLevel: { label: 'Stock level', options: ['low', 'sufficient'] },
  accountRole: { label: 'Role', options: USER_ROLES },
  accountActive: { label: 'Account state', options: ['active', 'inactive'] },
} satisfies Record<string, { label: string; options: readonly string[] }>;

export type FilterFieldId = keyof typeof FILTER_FIELDS;

/** How a role reads on screen: `barangay_admin` is not a title an officer would recognise. */
const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'RHU administrator',
  barangay_admin: 'Barangay administrator',
  bhw: 'Health worker',
};

function optionLabel(field: FilterFieldId, value: string): string {
  return field === 'accountRole' ? ROLE_LABELS[value as UserRole] : titleCase(value);
}

type AdminFilterBarProps = {
  filters: AdminFilters;
  onChange: (filters: AdminFilters) => void;
  loading: boolean;
  snapshot: AdminSnapshot;
  /** Only an `admin` sees more than one barangay, so only an admin gets the picker. */
  role: UserRole | null;
  /**
   * The narrow filters this tab offers, in the order they should appear. Each
   * tab passes its own: the Residents drawer has no business offering a stock
   * level, and a drawer carrying every filter on every screen is the bar this
   * one replaced.
   */
  fields?: readonly FilterFieldId[];
  /**
   * Whether the purok picker is offered. Inventory passes `false`: stock is held
   * at barangay level and `fetchAdminSnapshot` deliberately leaves it out of the
   * purok guard, so a purok control there would claim a narrowing that never
   * happens.
   */
  puroks?: boolean;
  /** Reports only: the card picker. */
  sections?: boolean;
};

/**
 * The scope control: which period, which area, which slice of the tab's own
 * data, and what that combination actually governs.
 *
 * It used to be two bare `<input type="date">` fields labelled "Period from" and
 * "Period to", which was confusing for a reason that had nothing to do with the
 * inputs: half the numbers on the screen ignore the period entirely. Households,
 * residents and stock are running positions — a household does not stop existing
 * outside a date range — while assessments and releases are events inside it.
 * Two date fields with no statement of that read as a filter over everything.
 *
 * So the drawer says things in the order they are needed: the common ranges as
 * one click each, the area, the tab's own filters, the resolved range and scope
 * in words, and the one line naming what the range does not touch. Typing a
 * custom range is still possible and still uses the native picker — it is folded
 * away because it is the rarer act, not because it is secondary.
 *
 * On the page itself none of that is spent. A scope control is read far more
 * often than it is changed, so what stays on screen is one button in the page
 * header naming the active range, and the controls live behind it in a drawer
 * over the right edge. Opening them costs no page height at all, which a bar
 * spanning the content column could never manage.
 */
export function AdminFilterBar({
  filters,
  onChange,
  loading,
  snapshot,
  role,
  fields = [],
  puroks = true,
  sections = false,
}: AdminFilterBarProps) {
  const preset = activePreset(filters);
  const [open, setOpen] = useState(false);
  // Shown by default when the range matches no preset, so a custom range
  // arriving in a shared link shows the dates that produced it rather than
  // hiding them behind a control the reader has to think to open.
  const [showCustom, setShowCustom] = useState(preset === null);
  const canPickBarangay = role === 'admin' && snapshot.barangays.length > 1;
  const activeLabel = PERIOD_PRESETS.find((option) => option.id === preset)?.label ?? 'Custom range';
  const scope = describeScope(filters, snapshot);
  const range = `${formatDate(filters.from)} – ${formatDate(filters.to)}`;
  // A purok belongs to one barangay, so the list is the selected barangay's
  // once there is one. Offering all six across three barangays would let an
  // officer pick a purok that empties every panel on the screen.
  const purokOptions = filters.barangayId
    ? snapshot.puroks.filter((purok) => purok.barangay_id === filters.barangayId)
    : snapshot.puroks;
  // How many narrow filters are set, counted off the same table the URL round
  // trip uses. A filtered screen that looks unfiltered is the worst way this
  // control can fail, so the count rides on the closed trigger — the same
  // reason `IndividualsTable` shows its drill-down as a removable chip.
  const narrowCount =
    FILTER_PARAMS.filter(([key]) => key !== 'barangayId' && key !== 'purokId' && filters[key]).length +
    (filters.reportSections?.length ? 1 : 0);

  return (
    <div className="admin-filter-bar">
      {/* Closed, the trigger is still the caption: it names the active range,
          the barangay whenever the view is not all of them, and how many
          further filters are on. The full resolved dates go on the label, so
          the button stays one line without hiding them from a screen reader. */}
      <Button
        className="scope-trigger"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`Filters: ${range}, ${scope}${narrowCount ? `, ${narrowCount} more` : ''}`}
      >
        <Icon name="filter" size={16} />
        <span className="scope-value">{activeLabel}</span>
        {filters.barangayId ? <span className="scope-area">{scope}</span> : null}
        {narrowCount ? (
          <span className="scope-count" aria-hidden="true">
            +{narrowCount}
          </span>
        ) : null}
      </Button>

      <Modal open={open} title="Filters" onClose={() => setOpen(false)} className="filter-drawer">
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
                // A preset is the whole choice, so the drawer has done its job.
                // A custom range or a narrow filter is not: those leave it open.
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

        <div className="filter-fields">
          {canPickBarangay ? (
            <SelectField
              label="Barangay"
              value={filters.barangayId ?? ''}
              // The purok goes with it. A purok from the barangay just left
              // matches no household in the new one, so keeping it would empty
              // every panel on the screen under a heading naming the barangay.
              onChange={(event) => onChange({ ...filters, barangayId: event.target.value || null, purokId: null })}
            >
              <option value="">All barangays</option>
              {snapshot.barangays.map((barangay) => (
                <option key={barangay.barangay_id} value={barangay.barangay_id}>
                  {barangay.name}
                </option>
              ))}
            </SelectField>
          ) : null}

          {puroks && purokOptions.length ? (
            <SelectField
              label="Purok"
              value={filters.purokId ?? ''}
              onChange={(event) => onChange({ ...filters, purokId: event.target.value || null })}
            >
              <option value="">All puroks</option>
              {purokOptions.map((purok) => (
                <option key={purok.purok_id} value={purok.purok_id}>
                  {purok.name}
                </option>
              ))}
            </SelectField>
          ) : null}

          {fields.map((field) => (
            <SelectField
              key={field}
              label={FILTER_FIELDS[field].label}
              value={filters[field] ?? ''}
              // An empty option is the absence of the filter, not the string
              // "", which is what every consumer of `AdminFilters` treats as
              // unset and what `paramsFromFilters` drops from the URL.
              onChange={(event) => onChange({ ...filters, [field]: event.target.value || null })}
            >
              <option value="">All</option>
              {FILTER_FIELDS[field].options.map((option) => (
                <option key={option} value={option}>
                  {optionLabel(field, option)}
                </option>
              ))}
            </SelectField>
          ))}
        </div>

        {sections ? <SectionPicker filters={filters} onChange={onChange} /> : null}

        {/* The line the two date fields were missing. It is stated once, here,
            so the panels below can carry their period without each repeating
            the caveat. */}
        <p className="summary-context filter-caveat">
          Dates filter <strong>activity</strong> — assessments recorded and supplies released. Household, resident and
          stock figures are current totals and are not affected by the range.
        </p>

        <DataFreshness snapshot={snapshot} loading={loading} />
      </Modal>
    </div>
  );
}

/**
 * Which report cards to print.
 *
 * Checkboxes rather than a multi-select: four options that are read at a glance
 * and toggled independently, which is the one shape a `<select multiple>` is
 * worse at than plain inputs. Clearing every box writes `null` rather than an
 * empty list — an unfiltered Reports page shows every card, and a URL that says
 * "no sections" would otherwise render a blank screen with no explanation.
 */
function SectionPicker({ filters, onChange }: { filters: AdminFilters; onChange: (filters: AdminFilters) => void }) {
  const selected = filters.reportSections ?? [];

  return (
    <fieldset className="filter-sections">
      <legend>Report cards</legend>
      {REPORT_SECTIONS.map((section) => {
        // Nothing selected means every card, so every box reads as checked —
        // the alternative shows four empty boxes above four rendered cards.
        const checked = !selected.length || selected.includes(section.id);

        return (
          <label key={section.id}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                const base: string[] = selected.length ? selected : REPORT_SECTIONS.map((row) => row.id);
                const next = checked ? base.filter((id) => id !== section.id) : [...base, section.id];

                onChange({ ...filters, reportSections: next.length ? next : null });
              }}
            />
            {section.label}
          </label>
        );
      })}
    </fieldset>
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
  snapshot,
}: {
  filters: AdminFilters;
  extra?: string;
  /** Given, the caption names the barangay and purok as well as the range. */
  snapshot?: Pick<AdminSnapshot, 'barangays' | 'puroks'>;
}) {
  return (
    <p className="summary-context">
      {formatDate(filters.from)} – {formatDate(filters.to)}
      {snapshot && filters.barangayId ? ` · ${describeScope(filters, snapshot)}` : ''}
      {extra ? ` · ${extra}` : ''}
    </p>
  );
}
