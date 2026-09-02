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
 * take. Option lists are read off the tuples that define these unions wherever
 * one exists; `sex`, `itemType` and `stockLevel` have none, so they are listed
 * here and the `satisfies` below keeps them honest.
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
  /** The narrow filters this tab offers, in the order they should appear. */
  fields?: readonly FilterFieldId[];
  /** Whether the purok picker is offered. Inventory passes `false`, since stock is held at barangay level. */
  puroks?: boolean;
  /** Reports only: the card picker. */
  sections?: boolean;
};

/**
 * The scope control: which period, which area, which slice of the tab's own data,
 * and a line naming what the range does not touch — households, residents and
 * stock are running positions rather than events inside the period.
 *
 * Lives in a drawer behind one header button, since a scope control is read far
 * more often than it is changed.
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
  // Shown by default when the range matches no preset, so a custom range from a
  // shared link shows the dates that produced it.
  const [showCustom, setShowCustom] = useState(preset === null);
  const canPickBarangay = role === 'admin' && snapshot.barangays.length > 1;
  const activeLabel = PERIOD_PRESETS.find((option) => option.id === preset)?.label ?? 'Custom range';
  const scope = describeScope(filters, snapshot);
  const range = `${formatDate(filters.from)} – ${formatDate(filters.to)}`;
  // A purok belongs to one barangay, so the list is the selected barangay's once
  // there is one.
  const purokOptions = filters.barangayId
    ? snapshot.puroks.filter((purok) => purok.barangay_id === filters.barangayId)
    : snapshot.puroks;
  // How many narrow filters are set, counted off the same table the URL round
  // trip uses, and shown on the closed trigger so a filtered screen never looks
  // unfiltered.
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
                // A preset is the whole choice; a custom range or a narrow
                // filter is not, so those leave the drawer open.
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
              // The purok goes with it: one from the barangay just left matches
              // no household in the new one.
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
              // An empty option is the absence of the filter, not the string "",
              // which is what `AdminFilters` treats as unset.
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
 * Which report cards to print. Clearing every box writes `null` rather than an
 * empty list, so an unfiltered Reports page shows every card instead of none.
 */
function SectionPicker({ filters, onChange }: { filters: AdminFilters; onChange: (filters: AdminFilters) => void }) {
  const selected = filters.reportSections ?? [];

  return (
    <fieldset className="filter-sections">
      <legend>Report cards</legend>
      {REPORT_SECTIONS.map((section) => {
        // Nothing selected means every card, so every box reads as checked.
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

  // The epoch stamp is what `emptyAdminSnapshot` carries: no read has completed.
  if (snapshot.fetchedAt === new Date(0).toISOString()) {
    return <small className="muted">Not read yet.</small>;
  }

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
 * The caption under a summary, naming the period and filters that produced it.
 * The filter clause is printed only when there is one.
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
