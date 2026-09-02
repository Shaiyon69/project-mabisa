import type { ReactNode } from 'react';
import { ADULT_BMI_MIN_AGE, formatDate, titleCase } from '../../lib/utils';
import { buildReportCsv, downloadCsv, reportFileName, type CsvColumn } from '../../lib/csv';
import {
  AGE_BANDS,
  NUTRITION_ORDER,
  ageBandOf,
  assessmentsBelowAdultBmiAge,
  describeScope,
  disbursementsByItem,
  lowStockItems,
  showsSection,
  tally,
  type AdminFilters,
  type AdminSnapshot,
  type ReportSectionId,
} from '../../services/adminData';
import type { HealthAssessment, InventoryItem, SupplyDisbursement } from '../../types/database';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { SummaryContext } from './AdminFilterBar';
import { SummaryBars } from './SummaryBars';

type ReportCardsProps = {
  snapshot: AdminSnapshot;
  filters: AdminFilters;
};

/**
 * The four summaries FR-09 asks for, each with the CSV that reproduces it. Every
 * panel is an aggregate over the selected period and exports the exact rows it
 * was computed from, so the export can't drift from what's on screen.
 */
export function ReportCards({ snapshot, filters }: ReportCardsProps) {
  const lowStock = lowStockItems(snapshot.inventoryItems);
  const releasedTotal = snapshot.disbursements.reduce((sum, row) => sum + row.quantity, 0);
  // The barangay a CSV should name: the one that was picked, when one was, and
  // otherwise the account's own scope. A file taken while one barangay was
  // selected must not read later as the whole municipality.
  const scopeLabel = filters.barangayId ? describeScope(filters, snapshot) : snapshot.barangayLabel;

  return (
    <div className="activity-grid report-grid">
      <ReportPanel
        section="demographics"
        title="Resident demographics"
        note={`${snapshot.residentCount} resident(s) profiled centrally.`}
        filters={filters}
        scope={snapshot}
        filterNote="all residents, period ignored"
        onExport={() =>
          exportReport('Resident Demographics', scopeLabel, filters, buildDemographicRows(snapshot), [
            { header: 'Grouping', value: (row) => row.grouping },
            { header: 'Category', value: (row) => row.category },
            { header: 'Residents', value: (row) => row.count },
          ])
        }
      >
        <h4>By sex</h4>
        <SummaryBars
          rows={tally(snapshot.residents, (resident) => resident.sex, ['female', 'male'])}
          emptyTitle="No residents"
          emptyText="Resident profiles appear here once a BHW device has synced."
        />
        <h4>By age band</h4>
        <SummaryBars
          rows={tally(snapshot.residents, (resident) => ageBandOf(resident.birthday), AGE_BANDS.map((band) => band.label))}
          emptyTitle="No residents"
          emptyText="Age bands are computed from recorded birthdays."
        />
      </ReportPanel>

      <ReportPanel
        section="nutrition"
        title="Nutrition status summary"
        note={nutritionNote(snapshot)}
        filters={filters}
        scope={snapshot}
        onExport={() =>
          exportReport('Nutrition Status Summary', scopeLabel, filters, snapshot.assessments, assessmentColumns)
        }
      >
        <SummaryBars
          rows={tally(snapshot.assessments, (assessment) => assessment.nutrition_status, NUTRITION_ORDER)}
          emptyTitle="No assessments in this period"
          emptyText="Widen the date range, or wait for a field device to sync."
        />
      </ReportPanel>

      <ReportPanel
        section="stock"
        title="Unallocated barangay stock"
        note={`${snapshot.inventoryItems.length} item(s) tracked, ${lowStock.length} at or below the low-stock threshold. This is what the barangay still holds to hand out — quantities already allocated to a health worker are counted against that worker, not here. Stock is a current position and ignores the period.`}
        filters={filters}
        scope={snapshot}
        filterNote="none beyond the period (stock is current, not historical)"
        onExport={() =>
          exportReport('Unallocated Barangay Stock', scopeLabel, filters, snapshot.inventoryItems, inventoryColumns)
        }
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

      <ReportPanel
        section="supply"
        title="Supply allocation"
        note={`${releasedTotal} unit(s) across ${snapshot.disbursements.length} release(s).`}
        filters={filters}
        scope={snapshot}
        onExport={() =>
          exportReport('Supply Allocation', scopeLabel, filters, snapshot.disbursements, disbursementColumns(snapshot.inventoryItems))
        }
      >
        <SummaryBars
          rows={disbursementsByItem(snapshot.disbursements, snapshot.inventoryItems)}
          emptyTitle="No releases in this period"
          emptyText="Supply disbursements logged by a BHW appear here after sync."
        />
      </ReportPanel>
    </div>
  );
}

type ReportPanelProps = {
  /**
   * Which card this is, for the drawer's picker. The gate lives in the panel
   * rather than around each call site: a card that is not rendered exports
   * nothing and computes nothing, and one `if` here beats four ternaries
   * wrapping four JSX blocks.
   */
  section: ReportSectionId;
  title: string;
  note: string;
  filters: AdminFilters;
  scope: Pick<AdminSnapshot, 'barangays' | 'puroks'>;
  filterNote?: string;
  onExport: () => void;
  children: ReactNode;
};

function ReportPanel({ section, title, note, filters, scope, filterNote, onExport, children }: ReportPanelProps) {
  if (!showsSection(filters, section)) {
    return null;
  }

  return (
    <Card className="activity-card report-card" as="article">
      <div className="report-card-head">
        <h3>{title}</h3>
        <Button variant="ghost" onClick={onExport}>
          Export CSV
        </Button>
      </div>
      <SummaryContext filters={filters} extra={filterNote} snapshot={scope} />
      {children}
      <p className="muted report-note">{note}</p>
    </Card>
  );
}

/**
 * The nutrition panel's note. Says how many of the assessments are of residents the
 * adult cut-points do not classify, because the bars cannot show it themselves — a
 * child's reading stacks into the same four bands as everyone else's, and the reader
 * here never saw the caveat the BHW saw at the point of measurement.
 */
function nutritionNote(snapshot: AdminSnapshot): string {
  const belowAge = assessmentsBelowAdultBmiAge(snapshot.assessments, snapshot.residents);
  const caveat = belowAge
    ? ` ${belowAge} of them are of residents under ${ADULT_BMI_MIN_AGE}, whose measurements adult BMI does not classify — read those against the DOH/WHO growth charts, not these bands.`
    : '';

  return `${snapshot.assessments.length} assessment(s) recorded in this period. A status is the reading the measurements produced, not a diagnosis.${caveat}`;
}

function exportReport<Row>(
  title: string,
  barangay: string,
  filters: AdminFilters,
  rows: Row[],
  columns: CsvColumn<Row>[],
): void {
  downloadCsv(
    reportFileName(title),
    buildReportCsv({ title, barangay, from: filters.from, to: filters.to }, rows, columns),
  );
}

type DemographicRow = { grouping: string; category: string; count: number };

function buildDemographicRows(snapshot: AdminSnapshot): DemographicRow[] {
  return [
    ...tally(snapshot.residents, (resident) => resident.sex, ['female', 'male']).map((row) => ({
      grouping: 'Sex',
      category: titleCase(row.label),
      count: row.count,
    })),
    ...tally(
      snapshot.residents,
      (resident) => ageBandOf(resident.birthday),
      AGE_BANDS.map((band) => band.label),
    ).map((row) => ({ grouping: 'Age band', category: row.label, count: row.count })),
  ];
}

const assessmentColumns: CsvColumn<HealthAssessment>[] = [
  { header: 'Assessment ID', value: (row) => row.assessment_id },
  { header: 'Resident ID', value: (row) => row.resident_id },
  { header: 'Date', value: (row) => row.assessment_date },
  { header: 'Weight (kg)', value: (row) => row.weight },
  { header: 'Height (cm)', value: (row) => row.height },
  // The reading is exported beside the measurements that produced it, the same
  // rule the assessment screen follows — a status on its own is not reviewable.
  { header: 'BMI', value: (row) => row.bmi },
  { header: 'Nutrition status', value: (row) => titleCase(row.nutrition_status) },
];

const inventoryColumns: CsvColumn<InventoryItem>[] = [
  { header: 'Item ID', value: (row) => row.item_id },
  { header: 'Item', value: (row) => row.item_name },
  { header: 'Type', value: (row) => titleCase(row.type) },
  { header: 'Unallocated stock', value: (row) => row.current_stock },
  { header: 'Last updated', value: (row) => formatDate(row.updated_at) },
];

function disbursementColumns(items: InventoryItem[]): CsvColumn<SupplyDisbursement>[] {
  const names = new Map(items.map((item) => [item.item_id, item.item_name]));

  return [
    { header: 'Log ID', value: (row) => row.log_id },
    { header: 'Date', value: (row) => row.disbursement_date },
    { header: 'Item', value: (row) => names.get(row.item_id) ?? 'Unknown item' },
    { header: 'Item ID', value: (row) => row.item_id },
    { header: 'Resident ID', value: (row) => row.resident_id },
    { header: 'Quantity', value: (row) => row.quantity },
  ];
}
