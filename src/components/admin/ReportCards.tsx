import type { ReactNode } from 'react';
import { formatDate, titleCase } from '../../lib/utils';
import { exportReport, type CsvColumn } from '../../lib/csv';
import {
  AGE_BANDS,
  NUTRITION_ORDER,
  ageBandOf,
  describeScope,
  disbursementsByItem,
  lowStockItems,
  tally,
  type AdminFilters,
  type AdminSnapshot,
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
 * The four summaries FR-09 asks for, each with the CSV that reproduces it.
 *
 * These used to be the five most recent assessment rows and the five most recent
 * disbursements, which is a feed rather than a report: it answers "what happened
 * last" when an LGU officer needs "how many, over what period". Every panel here
 * is an aggregate over the selected period, states that period, and exports the
 * rows the aggregate was computed from — so the acceptance criterion that export
 * totals match the filtered source records is a property of the code rather than
 * a thing to check by hand.
 */
export function ReportCards({ snapshot, filters }: ReportCardsProps) {
  const lowStock = lowStockItems(snapshot.inventoryItems);
  const releasedTotal = snapshot.disbursements.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <div className="activity-grid report-grid">
      <ReportPanel
        title="Resident Demographics"
        note={`${snapshot.residentCount} resident(s) profiled centrally.`}
        filters={filters}
        barangays={snapshot.barangays}
        filterNote="all residents, period ignored"
        onExport={() =>
          exportReportFor('Resident Demographics', filters, snapshot.barangays, buildDemographicRows(snapshot), [
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
        title="Nutrition Status Summary"
        note={`${snapshot.assessments.length} assessment(s) in this period. A status is a reading, not a diagnosis.`}
        filters={filters}
        barangays={snapshot.barangays}
        onExport={() =>
          exportReportFor('Nutrition Status Summary', filters, snapshot.barangays, snapshot.assessments, assessmentColumns)
        }
      >
        <SummaryBars
          rows={tally(snapshot.assessments, (assessment) => assessment.nutrition_status, NUTRITION_ORDER)}
          emptyTitle="No assessments in this period"
          emptyText="Widen the date range, or wait for a field device to sync."
        />
      </ReportPanel>

      <ReportPanel
        title="Inventory On Hand"
        note={`${snapshot.inventoryItems.length} item(s) tracked, ${lowStock.length} low.`}
        filters={filters}
        barangays={snapshot.barangays}
        filterNote="current stock, period ignored"
        onExport={() => exportReportFor('Inventory On Hand', filters, snapshot.barangays, snapshot.inventoryItems, inventoryColumns)}
      >
        {lowStock.length ? (
          <ul className="compact-list">
            {lowStock.map((item) => (
              <li key={item.item_id}>
                <span>{item.item_name}</span>
                <small>
                  {item.current_stock} on hand • {titleCase(item.type)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No item is at or below the low-stock threshold.</p>
        )}
      </ReportPanel>

      <ReportPanel
        title="Supply Allocation"
        note={`${releasedTotal} unit(s) across ${snapshot.disbursements.length} release(s).`}
        filters={filters}
        barangays={snapshot.barangays}
        onExport={() =>
          exportReportFor('Supply Allocation', filters, snapshot.barangays, snapshot.disbursements, disbursementColumns(snapshot.inventoryItems))
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
  title: string;
  note: string;
  filters: AdminFilters;
  barangays: AdminSnapshot['barangays'];
  filterNote?: string;
  onExport: () => void;
  children: ReactNode;
};

function ReportPanel({ title, note, filters, barangays, filterNote, onExport, children }: ReportPanelProps) {
  return (
    <Card className="activity-card report-card" as="article">
      <div className="report-card-head">
        <h3>{title}</h3>
        <Button variant="ghost" onClick={onExport}>
          Export CSV
        </Button>
      </div>
      <SummaryContext filters={filters} extra={filterNote} barangays={barangays} />
      {children}
      <p className="muted report-note">{note}</p>
    </Card>
  );
}

/**
 * Every panel's export, carrying the same scope its caption states — the
 * barangay included, so a CSV taken while one barangay was selected cannot be
 * read later as the whole municipality.
 */
function exportReportFor<Row>(
  title: string,
  filters: AdminFilters,
  barangays: AdminSnapshot['barangays'],
  rows: Row[],
  columns: CsvColumn<Row>[],
): void {
  exportReport(
    {
      title,
      from: filters.from,
      to: filters.to,
      filters: [{ label: 'Barangay', value: describeScope(filters, barangays) }],
    },
    rows,
    columns,
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
  { header: 'Current stock', value: (row) => row.current_stock },
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
