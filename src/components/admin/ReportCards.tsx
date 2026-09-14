import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ADULT_BMI_MIN_AGE, ageInYears, formatCount, formatDate, isoLocalDay, titleCase } from '../../lib/utils';
import { NUTRITION_COLORS } from '../../lib/charts';
import {
  AGE_BANDS,
  ageBandOf,
  assessmentsBelowAdultBmiAge,
  latestPerResident,
  describeScope,
  disbursementsByItem,
  lowStockItems,
  nutritionTally,
  REPORT_SECTIONS,
  reorderLevelOf,
  residentHealthRows,
  showsSection,
  tally,
  type AdminFilters,
  type AdminSnapshot,
  type Tally,
} from '../../services/adminData';
import type { UserRole } from '../../types/database';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { SelectField } from '../common/FormField';
import { SummaryContext } from './AdminFilterBar';
import { SummaryBars } from './SummaryBars';

type ReportCardsProps = {
  snapshot: AdminSnapshot;
  filters: AdminFilters;
};

type ReportControlsProps = ReportCardsProps & {
  onFiltersChange: (filters: AdminFilters) => void;
  loading: boolean;
  /** Only an `admin` reads more than one barangay; a barangay administrator's area is fixed by RLS. */
  role: UserRole | null;
};

/** The four period summaries on screen, and the printable report built from the same snapshot. */
export function ReportCards({ snapshot, filters, onFiltersChange, loading, role }: ReportControlsProps) {
  const lowStock = lowStockItems(snapshot.inventoryItems);
  const releasedTotal = snapshot.disbursements.reduce((sum, row) => sum + row.quantity, 0);
  const scope = filters.barangayId ? describeScope(filters, snapshot) : snapshot.barangayLabel;
  const [kind, setKind] = useState<ReportKind>('summary');

  return (
    <div className="report-grid-wrap">
      <div className="report-print-actions">
        {role === 'admin' ? (
          <SelectField
            label="Area"
            value={filters.barangayId ?? ''}
            onChange={(event) => onFiltersChange({ ...filters, barangayId: event.target.value || null, purokId: null })}
          >
            <option value="">All barangays</option>
            {snapshot.barangays.map((barangay) => (
              <option key={barangay.barangay_id} value={barangay.barangay_id}>
                {barangay.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <SelectField label="Report to export" value={kind} onChange={(event) => setKind(event.target.value as ReportKind)}>
          {Object.entries(REPORT_KINDS).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </SelectField>
        {/* Disabled mid-read, so a report printed right after an area change cannot carry the previous area's rows. */}
        <Button onClick={() => printReport(REPORT_KINDS[kind].title, scope)} disabled={loading}>
          Export report
        </Button>
      </div>
      <PrintReport snapshot={snapshot} filters={filters} scope={scope} kind={kind} />
      <div className="activity-grid report-grid">
      {showsSection(filters, 'demographics') ? (
        <ReportPanel
          title="Resident demographics"
          note={`${snapshot.residentCount} resident(s) profiled centrally.`}
          filters={filters}
          scope={snapshot}
          filterNote="all residents, period ignored"
        >
          {/* Sex is two rows and age is five, so stacked they left the right of a
            half-width card empty for both. Peer groups, so neither takes the
            narrow column the ring panels use. */}
          <div className="chart-split chart-split-even">
            <div>
              <h4>By sex</h4>
              <SummaryBars
                rows={tally(snapshot.residents, (resident) => resident.sex, ['female', 'male'])}
                emptyTitle="No residents"
                emptyText="Residents appear here once a health worker's phone has sent its records."
              />
            </div>
            <div>
              <h4>By age band</h4>
              <SummaryBars
                rows={tally(snapshot.residents, (resident) => ageBandOf(resident.birthday), AGE_BANDS.map((band) => band.label))}
                emptyTitle="No residents"
                emptyText="Age bands are computed from recorded birthdays."
              />
            </div>
          </div>
        </ReportPanel>
      ) : null}

      {showsSection(filters, 'nutrition') ? (
        <ReportPanel
          title="Nutrition status summary"
          note={nutritionNote(snapshot)}
          filters={filters}
          scope={snapshot}
        >
          <SummaryBars
            rows={nutritionTally(snapshot.assessments)}
            colorFor={(row) => NUTRITION_COLORS[row.label]}
            emptyTitle="No residents checked in this period"
            emptyText="Try a wider date range, or wait for a health worker's phone to send its records."
          />
        </ReportPanel>
      ) : null}

      {showsSection(filters, 'stock') ? (
        <ReportPanel
          title="Stock still at the barangay"
          note={`${snapshot.inventoryItems.length} item(s), ${lowStock.length} at or below the low-stock level. Unallocated stock only — not what health workers are carrying.`}
          filters={filters}
          scope={snapshot}
          filterNote="none beyond the period (stock is current, not historical)"
        >
          {lowStock.length ? (
            <ul className="compact-list">
              {lowStock.map((item) => (
                <li key={item.item_id}>
                  <span>{item.item_name}</span>
                  <small>
                    {item.current_stock} unallocated • {titleCase(item.type)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No item is at or below the low-stock threshold.</p>
          )}
        </ReportPanel>
      ) : null}

      {showsSection(filters, 'supply') ? (
        <ReportPanel
          title="Supplies given out"
          note={`${releasedTotal} unit(s) across ${snapshot.disbursements.length} release(s).`}
          filters={filters}
          scope={snapshot}
        >
          <SummaryBars
            rows={disbursementsByItem(snapshot.disbursements, snapshot.inventoryItems)}
            emptyTitle="No releases in this period"
            emptyText="Supplies a health worker hands out appear here once their phone sends the records."
          />
        </ReportPanel>
      ) : null}
      </div>
    </div>
  );
}

type ReportPanelProps = {
  title: string;
  note: string;
  filters: AdminFilters;
  scope: Pick<AdminSnapshot, 'barangays' | 'puroks'>;
  filterNote?: string;
  children: ReactNode;
};

function ReportPanel({ title, note, filters, scope, filterNote, children }: ReportPanelProps) {
  return (
    <Card className="activity-card report-card" as="article">
      <div className="report-card-head">
        <h3>{title}</h3>
      </div>
      <SummaryContext filters={filters} extra={filterNote} snapshot={scope} />
      {children}
      <p className="muted report-note">{note}</p>
    </Card>
  );
}

/**
 * The nutrition panel's note. Says what the bars count — one band per resident,
 * their latest — and how many of those residents the adult cut-points do not
 * classify, which the bars cannot show since a child's reading stacks into the
 * same four bands as everyone else's.
 */
function nutritionNote(snapshot: AdminSnapshot): string {
  const latest = latestPerResident(snapshot.assessments);
  const belowAge = assessmentsBelowAdultBmiAge(latest, snapshot.residents);
  const caveat = belowAge
    ? ` ${belowAge} are under ${ADULT_BMI_MIN_AGE} — read those against the DOH/WHO growth charts, not these bands.`
    : '';

  return `${latest.length} resident(s), each under their latest of ${snapshot.assessments.length} check(s) in this period. A status is a reading, not a diagnosis.${caveat}`;
}

/** The printable reports, each its own document. */
const REPORT_KINDS = {
  summary: { label: 'Summary charts', title: 'Health and Supply Summary' },
  residents: { label: 'Resident list', title: 'Resident List' },
  health: { label: 'Resident health records', title: 'Resident Health Records' },
} as const;

type ReportKind = keyof typeof REPORT_KINDS;

/** Opens the print dialog on the report document, titled so "Save as PDF" names the file after it. */
function printReport(title: string, scope: string) {
  const previous = document.title;

  document.title = `BRHP-MSAM ${title} - ${scope} - ${isoLocalDay(new Date())}`;
  window.addEventListener('afterprint', () => (document.title = previous), { once: true });
  window.print();
}

const DATE_TIME = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeStyle: 'short' });

type PrintProps = ReportCardsProps & { period: string };

/** The print-only report: hidden on screen, the only thing on the page when printed. */
function PrintReport({ snapshot, filters, scope, kind }: ReportCardsProps & { scope: string; kind: ReportKind }) {
  const period = `${formatDate(filters.from)} – ${formatDate(filters.to)}`;

  return createPortal(
    <article className={`print-report print-report-${kind}`}>
      <header className="pr-head">
        <img src="/assets/logo.png" alt="" />
        <div>
          <p className="pr-eyebrow">Barangay Residents Health Profiling and Medical Supply Allocation Monitoring System</p>
          <h1 className="pr-title">{REPORT_KINDS[kind].title}</h1>
        </div>
        <dl className="pr-meta">
          <dt>Area</dt>
          <dd>{scope}</dd>
          <dt>Period</dt>
          <dd>{kind === 'residents' ? 'Current register' : period}</dd>
          <dt>Data as of</dt>
          <dd>{DATE_TIME.format(new Date(snapshot.fetchedAt))}</dd>
        </dl>
      </header>

      {kind === 'summary' ? <PrintSummary snapshot={snapshot} filters={filters} period={period} /> : null}
      {kind === 'residents' ? <PrintResidents snapshot={snapshot} /> : null}
      {kind === 'health' ? <PrintHealth snapshot={snapshot} filters={filters} period={period} /> : null}

      <footer className="pr-sign">
        {['Prepared by', 'Noted by'].map((role) => (
          <div key={role}>
            <p>{role}</p>
            <span>Signature over printed name / Date</span>
          </div>
        ))}
      </footer>
      <p className="pr-foot">
        Generated by BRHP-MSAM from records synced by barangay health workers.
        {kind === 'residents' ? '' : ' A nutrition status is a reading, not a diagnosis.'}
      </p>
    </article>,
    document.body,
  );
}

function PrintFigures({ figures }: { figures: { label: string; value: number }[] }) {
  return (
    <div className="pr-figures">
      {figures.map((figure) => (
        <div className="pr-figure" key={figure.label}>
          <strong>{formatCount(figure.value)}</strong>
          <span>{figure.label}</span>
        </div>
      ))}
    </div>
  );
}

/** The period summaries as tables and bars, honouring the section picker. */
function PrintSummary({ snapshot, filters, period }: PrintProps) {
  const lowStock = new Set(lowStockItems(snapshot.inventoryItems).map((item) => item.item_id));
  const stock = [...snapshot.inventoryItems].sort(
    (a, b) => Number(lowStock.has(b.item_id)) - Number(lowStock.has(a.item_id)) || a.item_name.localeCompare(b.item_name),
  );
  const sections = REPORT_SECTIONS.filter((section) => showsSection(filters, section.id));
  const numberOf = (id: (typeof REPORT_SECTIONS)[number]['id']) =>
    String(sections.findIndex((section) => section.id === id) + 1).padStart(2, '0');
  const figures = [
    { id: 'demographics', label: 'Residents profiled', value: snapshot.residentCount },
    { id: 'nutrition', label: 'Residents checked', value: latestPerResident(snapshot.assessments).length },
    { id: 'stock', label: 'Items low on stock', value: lowStock.size },
    { id: 'supply', label: 'Units released', value: snapshot.disbursements.reduce((sum, row) => sum + row.quantity, 0) },
  ] as const;

  return (
    <>
      <PrintFigures figures={figures.filter((figure) => showsSection(filters, figure.id))} />

      {showsSection(filters, 'demographics') ? (
        <PrintSection number={numberOf('demographics')} title="Resident demographics" context="All residents on the register; the period does not apply.">
          <div className="pr-split">
            <ShareTable caption="By sex" heading="Sex" rows={tally(snapshot.residents, (resident) => resident.sex, ['female', 'male'])} />
            <ShareTable
              caption="By age band"
              heading="Age band"
              rows={tally(snapshot.residents, (resident) => ageBandOf(resident.birthday), AGE_BANDS.map((band) => band.label))}
            />
          </div>
        </PrintSection>
      ) : null}

      {showsSection(filters, 'nutrition') ? (
        <PrintSection number={numberOf('nutrition')} title="Nutrition status" context={`Health checks from ${period}.`}>
          <ShareTable
            caption="Residents by latest nutrition status"
            heading="Status"
            rows={nutritionTally(snapshot.assessments)}
            colorFor={(row) => NUTRITION_COLORS[row.label]}
          />
          <p className="pr-note">{nutritionNote(snapshot)}</p>
        </PrintSection>
      ) : null}

      {showsSection(filters, 'stock') ? (
        <PrintSection number={numberOf('stock')} title="Stock still at the barangay" context="Unallocated stock as of the data date, not what health workers are carrying.">
          {stock.length ? (
            <table className="pr-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th className="num">On hand</th>
                  <th className="num">Reorder level</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((item) => (
                  <tr key={item.item_id}>
                    <td>{item.item_name}</td>
                    <td>{titleCase(item.type)}</td>
                    <td className="num">{formatCount(item.current_stock)}</td>
                    <td className="num">{reorderLevelOf(item) || 'Off'}</td>
                    <td>
                      {lowStock.has(item.item_id) ? <span className="pr-flag">Low</span> : <span className="pr-flag pr-flag-ok">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pr-empty">No items stocked.</p>
          )}
        </PrintSection>
      ) : null}

      {showsSection(filters, 'supply') ? (
        <PrintSection
          number={numberOf('supply')}
          title="Supplies given out"
          context={`${formatCount(snapshot.disbursements.length)} release(s) to residents from ${period}.`}
        >
          <ShareTable
            caption="Units released by item"
            heading="Item"
            unit="Units"
            rows={disbursementsByItem(snapshot.disbursements, snapshot.inventoryItems)}
          />
        </PrintSection>
      ) : null}
    </>
  );
}

/** Every active resident on the register, by barangay and household. */
function PrintResidents({ snapshot }: Pick<ReportCardsProps, 'snapshot'>) {
  const active = new Set(snapshot.residents.map((resident) => resident.resident_id));
  const households = new Map(snapshot.households.map((household) => [household.household_id, household]));
  const barangays = new Map(snapshot.barangays.map((barangay) => [barangay.barangay_id, barangay.name]));
  const rows = snapshot.people
    .filter((person) => active.has(person.resident_id))
    .map((person) => {
      const household = households.get(person.household_id);

      return {
        person,
        householdNumber: household?.household_number ?? '',
        barangay: (household?.barangay_id && barangays.get(household.barangay_id)) || 'Unassigned',
      };
    })
    .sort(
      (a, b) =>
        a.barangay.localeCompare(b.barangay) ||
        a.householdNumber.localeCompare(b.householdNumber, undefined, { numeric: true }) ||
        a.person.last_name.localeCompare(b.person.last_name) ||
        a.person.first_name.localeCompare(b.person.first_name),
    );
  const sexes = tally(snapshot.residents, (resident) => resident.sex, ['female', 'male']);

  return (
    <>
      <PrintFigures
        figures={[
          { label: 'Residents', value: rows.length },
          { label: 'Households', value: snapshot.householdCount },
          ...sexes.map((row) => ({ label: titleCase(row.label), value: row.count })),
        ]}
      />
      <PrintSection number="01" title="Residents on the register" context="Active residents, by barangay and household number.">
        {rows.length ? (
          <table className="pr-table pr-dense">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Resident</th>
                <th>Sex</th>
                <th className="num">Age</th>
                <th>Birthday</th>
                <th>Household</th>
                <th>Barangay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.person.resident_id}>
                  <td className="num">{index + 1}</td>
                  <td className="pr-wrap">
                    {row.person.last_name}, {row.person.first_name}
                  </td>
                  <td>{titleCase(row.person.sex)}</td>
                  <td className="num">{ageInYears(row.person.birthday) ?? '—'}</td>
                  <td>{formatDate(row.person.birthday)}</td>
                  <td>{row.householdNumber || '—'}</td>
                  <td>{row.barangay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pr-empty">No residents on the register.</p>
        )}
      </PrintSection>
    </>
  );
}

/** Each resident's latest check in the period, one row each. Printed landscape for the width. */
function PrintHealth({ snapshot, period }: PrintProps) {
  const rows = residentHealthRows(snapshot);
  const blank = (value: number | null | undefined) => value ?? '—';

  return (
    <>
      <PrintFigures
        figures={[
          { label: 'Residents checked', value: rows.length },
          { label: 'Checks in period', value: snapshot.assessments.length },
          ...nutritionTally(snapshot.assessments).map((row) => ({ label: titleCase(row.label), value: row.count })),
        ]}
      />
      <PrintSection number="01" title="Resident health records" context={`Each resident's latest health check from ${period}.`}>
        {rows.length ? (
          <table className="pr-table pr-dense">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Resident</th>
                <th className="num">Age</th>
                <th>Sex</th>
                <th>Household</th>
                <th>Barangay</th>
                <th>Last check</th>
                <th className="num">Wt (kg)</th>
                <th className="num">Ht (cm)</th>
                <th className="num">BMI</th>
                <th>Nutrition</th>
                <th className="num">BP</th>
                <th className="num">Temp</th>
                <th className="num">Pulse</th>
                <th>Illness</th>
                <th>Complications</th>
                <th>Vaccination</th>
                <th className="num">Checks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.person.resident_id}>
                  <td className="num">{index + 1}</td>
                  <td className="pr-wrap">
                    {row.person.last_name}, {row.person.first_name}
                  </td>
                  <td className="num">{ageInYears(row.person.birthday) ?? '—'}</td>
                  <td>{titleCase(row.person.sex)}</td>
                  <td>{row.householdNumber || '—'}</td>
                  <td>{row.barangay}</td>
                  <td>{formatDate(row.latest.assessment_date)}</td>
                  <td className="num">{blank(row.latest.weight)}</td>
                  <td className="num">{blank(row.latest.height)}</td>
                  <td className="num">{blank(row.latest.bmi)}</td>
                  <td>
                    {row.latest.nutrition_status ? (
                      <span className="pr-dot" style={{ background: NUTRITION_COLORS[row.latest.nutrition_status] }} />
                    ) : null}
                    {titleCase(row.latest.nutrition_status ?? '—')}
                  </td>
                  <td className="num">
                    {row.latest.systolic_bp != null ? `${row.latest.systolic_bp}/${row.latest.diastolic_bp ?? '—'}` : '—'}
                  </td>
                  <td className="num">{blank(row.latest.temperature_c)}</td>
                  <td className="num">{blank(row.latest.pulse_rate)}</td>
                  <td className="pr-wrap">
                    {row.latest.primary_illness === 'other'
                      ? row.latest.illness_other || 'Other'
                      : titleCase(row.latest.primary_illness ?? 'none')}
                  </td>
                  <td className="pr-wrap">{row.latest.health_complications?.map(titleCase).join(', ') || 'None'}</td>
                  <td>{titleCase(row.latest.vaccination_status ?? 'unknown')}</td>
                  <td className="num">{row.checks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pr-empty">No health checks in this period.</p>
        )}
      </PrintSection>
    </>
  );
}

function PrintSection({ number, title, context, children }: { number: string; title: string; context: string; children: ReactNode }) {
  return (
    <section className="pr-section">
      <h2>
        <span>{number}</span>
        {title}
      </h2>
      <p className="pr-context">{context}</p>
      {children}
    </section>
  );
}

/** A distribution as a table: count, share, and a bar drawn to the share. */
function ShareTable({
  caption,
  heading,
  unit = 'Residents',
  rows,
  colorFor,
}: {
  caption: string;
  heading: string;
  unit?: string;
  rows: Tally[];
  colorFor?: (row: Tally) => string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  if (!total) {
    return <p className="pr-empty">Nothing recorded for {caption.toLowerCase()}.</p>;
  }

  return (
    <table className="pr-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th>{heading}</th>
          <th className="num">{unit}</th>
          <th className="num">Share</th>
          <th className="pr-bar-col" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const share = Math.round((row.count / total) * 100);

          return (
            <tr key={row.label}>
              <td>{titleCase(row.label)}</td>
              <td className="num">{formatCount(row.count)}</td>
              <td className="num">{share}%</td>
              <td className="pr-bar-col">
                <span className="pr-bar" style={{ width: `${share}%`, background: colorFor?.(row) }} />
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th>Total</th>
          <th className="num">{formatCount(total)}</th>
          <th className="num">100%</th>
          <th />
        </tr>
      </tfoot>
    </table>
  );
}
