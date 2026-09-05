import { NUTRITION_COLORS, SERIES_COLORS } from '../../lib/charts';
import { titleCase } from '../../lib/utils';
import { exportReport, type CsvColumn } from '../../lib/csv';
import {
  AGE_BANDS,
  NUTRITION_ORDER,
  ageBandOf,
  barangayStats,
  describeScope,
  lowStockItems,
  monthlyTrend,
  nutritionByBarangay,
  supplyUtilization,
  tally,
  type AdminFilters,
  type AdminSnapshot,
  type BarangayStats,
  type ItemUtilization,
  type Tally,
  type TrendPoint,
} from '../../services/adminData';
import type { InventoryItemType } from '../../types/database';
import { Button } from '../common/Button';
import { BarChart, DonutChart, GaugeRing, LineChart } from './Charts';
import { Card } from '../common/Card';
import { EmptyState } from '../common/StateMessage';
import { Table, type TableColumn } from '../common/Table';
import { SummaryContext } from './AdminFilterBar';

/**
 * The analyses the period summaries cannot answer: how the numbers are moving,
 * how the barangays compare, how much of the register has been reached, and where
 * the supplies went. Each panel exports on its own, and all are computed from the
 * one snapshot the page already read.
 */
export function AnalyticsPanels({ snapshot, filters }: { snapshot: AdminSnapshot; filters: AdminFilters }) {
  // Read off `unscoped` and the session's own barangay, so picking one barangay
  // narrows the panels below but never deletes the others from a comparison.
  // An RHU account compares every barangay; a barangay administrator has one.
  const stats = barangayStats(snapshot.unscoped, snapshot.sessionBarangayId);
  const scope = describeScope(filters, snapshot);
  // What those two panels actually cover, which is not what the picker says.
  const everyBarangay = snapshot.barangayLabel;

  return (
    // The half-width panels are adjacent so they share a row, and there are two
    // rather than three: an odd one leaves the last row half empty. The trend took
    // the full width instead, its line chart being the worst squeezed by half.
    <div className="activity-grid report-grid">
      {/* Demographics and stock lead because they are the two panels drawn from
          rows that exist the moment a barangay is profiled. Everything below
          them counts assessments and releases, which only appear once field
          devices start syncing — a screen that opens on four empty states reads
          as broken rather than as new. */}
      <DemographicsPanel snapshot={snapshot} filters={filters} scope={scope} />
      <StockPanel snapshot={snapshot} filters={filters} scope={scope} />
      <CoveragePanel stats={stats} filters={filters} scope={everyBarangay} />
      <TrendPanel snapshot={snapshot} filters={filters} scope={scope} />
      <ComparisonPanel snapshot={snapshot} stats={stats} filters={filters} scope={everyBarangay} />
      <UtilizationPanel snapshot={snapshot} filters={filters} scope={scope} />
    </div>
  );
}

type PanelProps = {
  filters: AdminFilters;
  scope: string;
};

/** The report context every export on this screen shares. */
function contextFor(title: string, { filters, scope }: PanelProps) {
  // `barangay` is the heading the CSV prints, so it carries the same scope the
  // panel's caption states.
  return { title, barangay: scope, from: filters.from, to: filters.to, filters: [{ label: 'Barangay', value: scope }] };
}

function PanelHead({ title, onExport }: { title: string; onExport: () => void }) {
  return (
    <div className="report-card-head">
      <h3>{title}</h3>
      <Button variant="ghost" onClick={onExport}>
        Export CSV
      </Button>
    </div>
  );
}

const trendColumns: CsvColumn<TrendPoint>[] = [
  { header: 'Month', value: (row) => row.month },
  { header: 'Assessments', value: (row) => row.assessments },
  { header: 'Underweight', value: (row) => row.underweight },
  { header: 'Underweight rate', value: (row) => (row.rate === null ? '' : `${Math.round(row.rate * 100)}%`) },
];

/**
 * Assessments per month, with the underweight readings among them on the same
 * axis. Two counts rather than a rate, since a falling underweight count alone
 * cannot tell improvement from nobody being weighed.
 */
function TrendPanel({ snapshot, filters, scope }: { snapshot: AdminSnapshot } & PanelProps) {
  const points = monthlyTrend(snapshot.assessments, filters);
  const recorded = points.reduce((sum, point) => sum + point.assessments, 0);

  return (
    <Card className="activity-card report-card report-card-wide" as="article">
      <PanelHead
        title="Assessment trend"
        onExport={() => exportReport(contextFor('Assessment Trend', { filters, scope }), points, trendColumns)}
      />
      <SummaryContext filters={filters} extra={scope} />
      {recorded ? (
        <LineChart
          rows={points.map((point) => ({
            key: point.month,
            label: point.label,
            values: [point.assessments, point.underweight],
          }))}
          series={[
            { label: 'Assessments', color: SERIES_COLORS[0] },
            { label: 'Underweight', color: NUTRITION_COLORS.underweight },
          ]}
        />
      ) : (
        <EmptyState
          title="No assessments in this period"
          text="Widen the date range, or wait for a field device to sync."
        />
      )}
      <p className="muted report-note">
        Both lines count assessments in the month: all of them, and the underweight readings among them. A month sitting
        at zero had none recorded at all. The underweight rate is in the table and the CSV, not on a second axis.
      </p>
    </Card>
  );
}

const comparisonColumns: CsvColumn<BarangayStats>[] = [
  { header: 'Barangay', value: (row) => row.name },
  { header: 'Households', value: (row) => row.households },
  { header: 'Residents', value: (row) => row.residents },
  { header: 'Assessments in period', value: (row) => row.assessments },
  { header: 'Underweight', value: (row) => row.underweight },
  {
    header: 'Underweight rate',
    value: (row) => (row.underweightRate === null ? '' : `${Math.round(row.underweightRate * 100)}%`),
  },
  { header: 'Residents assessed', value: (row) => row.residentsAssessed },
  { header: 'Coverage', value: (row) => (row.coverageRate === null ? '' : `${Math.round(row.coverageRate * 100)}%`) },
  { header: 'Units released', value: (row) => row.unitsReleased },
];

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

const distributionColumns: CsvColumn<Tally>[] = [
  { header: 'Category', value: (row) => titleCase(row.label) },
  { header: 'Residents', value: (row) => row.count },
];

/**
 * Who is on the register: the sex split as a ring, the age profile as bars. Both
 * count residents rather than assessments, so both ignore the period — which the
 * note says out loud, since every other panel here is period-scoped.
 */
function DemographicsPanel({ snapshot, filters, scope }: { snapshot: AdminSnapshot } & PanelProps) {
  const sexes = tally(snapshot.residents, (resident) => resident.sex, ['female', 'male']);
  const ages = tally(snapshot.residents, (resident) => ageBandOf(resident.birthday), AGE_BANDS.map((band) => band.label));
  const sexColors: Record<string, string> = { female: SERIES_COLORS[0], male: SERIES_COLORS[1] };

  return (
    <Card className="activity-card report-card report-card-wide" as="article">
      <PanelHead
        title="Resident profile"
        onExport={() =>
          exportReport(contextFor('Resident Profile', { filters, scope }), [...sexes, ...ages], distributionColumns)
        }
      />
      <SummaryContext filters={filters} extra={scope} />
      {snapshot.residents.length ? (
        <div className="chart-split">
          <div>
            <h4>By sex</h4>
            <DonutChart rows={sexes} colorFor={(row) => sexColors[row.label]} unit="residents">
              <ul className="chart-breakdown">
                {sexes.map((row) => (
                  <li key={row.label}>
                    <span className="chart-swatch" style={{ background: sexColors[row.label] }} aria-hidden="true" />
                    <span>{titleCase(row.label)}</span>
                    <strong>{row.count}</strong>
                  </li>
                ))}
              </ul>
            </DonutChart>
          </div>
          <div>
            <h4>By age band</h4>
            <BarChart
              rows={ages.map((row) => ({ label: row.label, values: [row.count] }))}
              series={[{ label: 'Residents', color: SERIES_COLORS[0] }]}
            />
          </div>
        </div>
      ) : (
        <EmptyState
          title="No residents in this scope"
          text="Resident profiles appear here once a household has been recorded in the selected area."
        />
      )}
      <p className="muted report-note">
        Counts active residents on the register right now, so the selected period does not apply. A resident whose
        birthday is missing or in the future falls into no band and is left out of the age chart.
      </p>
    </Card>
  );
}

const stockColumns: CsvColumn<Tally>[] = [
  { header: 'Item type', value: (row) => titleCase(row.label) },
  { header: 'Units unallocated', value: (row) => row.count },
];

/**
 * The stock position by type, and how much of it is running out. Units per type
 * rather than items, so the sum is done here rather than by `tally`. The
 * low-stock ring reads `lowStockItems`, the same call the table's badge makes.
 */
function StockPanel({ snapshot, filters, scope }: { snapshot: AdminSnapshot } & PanelProps) {
  const types: InventoryItemType[] = ['medicine', 'food', 'equipment', 'hygiene', 'other'];
  const byType: Tally[] = types
    .map((type) => ({
      label: type,
      count: snapshot.inventoryItems
        .filter((item) => item.type === type)
        .reduce((sum, item) => sum + item.current_stock, 0),
    }))
    // A type the barangay stocks nothing of does not apply here at all.
    .filter((row) => row.count > 0);
  const low = lowStockItems(snapshot.inventoryItems);
  const health: Tally[] = [
    { label: 'at or below reorder level', count: low.length },
    { label: 'sufficient', count: snapshot.inventoryItems.length - low.length },
  ];
  const healthColors: Record<string, string> = {
    'at or below reorder level': 'var(--danger)',
    sufficient: SERIES_COLORS[0],
  };

  return (
    <Card className="activity-card report-card" as="article">
      <PanelHead
        title="Stock position"
        onExport={() => exportReport(contextFor('Stock Position', { filters, scope }), byType, stockColumns)}
      />
      <SummaryContext filters={filters} extra={scope} />
      {snapshot.inventoryItems.length ? (
        <div className="chart-split">
          <div>
            <h4>Items by reorder level</h4>
            <DonutChart rows={health} colorFor={(row) => healthColors[row.label]} unit="items">
              <ul className="chart-breakdown">
                {health.map((row) => (
                  <li key={row.label}>
                    <span className="chart-swatch" style={{ background: healthColors[row.label] }} aria-hidden="true" />
                    <span>{titleCase(row.label)}</span>
                    <strong>{row.count}</strong>
                  </li>
                ))}
              </ul>
            </DonutChart>
          </div>
          {byType.length ? (
            <div>
              <h4>Units on hand by type</h4>
              <BarChart
                rows={byType.map((row) => ({ label: titleCase(row.label), values: [row.count] }))}
                series={[{ label: 'Units unallocated', color: SERIES_COLORS[1] }]}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState title="Nothing stocked yet" text="A barangay administrator adds supplies from the Inventory screen." />
      )}
      <p className="muted report-note">
        Unallocated stock only — what the barangay still holds, not what health workers are carrying. Stock is a current
        position, so the selected period does not apply. An item whose reorder level is 0 has its warning switched off
        and never counts as low.
      </p>
    </Card>
  );
}

/** Every barangay side by side, including the ones holding nothing. */
function ComparisonPanel({
  snapshot,
  stats,
  filters,
  scope,
}: { snapshot: AdminSnapshot; stats: BarangayStats[] } & PanelProps) {
  const plotted = stats.some((row) => row.residents || row.assessments || row.underweight);
  // The whole nutrition mix per barangay, next to the single underweight share
  // the bars and the table above carry.
  const mix = nutritionByBarangay(snapshot.unscoped, snapshot.sessionBarangayId);
  const columns: TableColumn<BarangayStats>[] = [
    { key: 'name', header: 'Barangay', render: (row) => row.name },
    { key: 'households', header: 'Households', render: (row) => row.households },
    { key: 'residents', header: 'Residents', render: (row) => row.residents },
    { key: 'assessments', header: 'Assessments', render: (row) => row.assessments },
    {
      key: 'underweight',
      header: 'Underweight',
      render: (row) => `${percent(row.underweightRate)} (${row.underweight})`,
    },
    { key: 'released', header: 'Units released', render: (row) => row.unitsReleased },
  ];

  return (
    <Card className="activity-card report-card report-card-wide" as="article">
      <PanelHead
        title="Barangay comparison"
        onExport={() => exportReport(contextFor('Barangay Comparison', { filters, scope }), stats, comparisonColumns)}
      />
      <SummaryContext filters={filters} extra={scope} />
      {/* Residents and assessments on one shared scale, which is the point of
          the chart: a barangay with a tall resident bar and a short assessment
          bar is a coverage gap, and two separately-scaled charts would hide it.
          The table underneath carries the rates and the exact figures.

          Guarded on the figures rather than on the barangay count: three
          barangays holding nothing at all draw three empty tracks, which reads
          as a chart that failed rather than as a scope with no records yet. */}
      {plotted ? (
        <BarChart
          rows={stats.map((row) => ({
            key: row.barangayId || 'unassigned',
            label: row.name,
            values: [row.residents, row.assessments, row.underweight],
          }))}
          series={[
            { label: 'Residents', color: SERIES_COLORS[0] },
            { label: 'Assessments', color: SERIES_COLORS[1] },
            { label: 'Underweight', color: NUTRITION_COLORS.underweight },
          ]}
        />
      ) : (
        <EmptyState
          title="Nothing to compare yet"
          text="Barangay figures appear here once households and assessments have synced."
        />
      )}
      {/* Four bands per barangay on one scale. Only drawn when something was
          assessed: four empty tracks per barangay is the same false "chart
          failed" reading the guard above avoids. Band colours are the BMI
          rail's, so a band is one colour on the phone and here. */}
      {mix.some((row) => row.values.some((value) => value)) ? (
        <>
          <h4>Nutrition mix by barangay</h4>
          <BarChart
            rows={mix}
            series={NUTRITION_ORDER.map((status) => ({ label: titleCase(status), color: NUTRITION_COLORS[status] }))}
          />
        </>
      ) : null}
      <Table
        columns={columns}
        rows={stats}
        getRowKey={(row) => row.barangayId || 'unassigned'}
        emptyTitle="No barangays"
        emptyText="Barangay records appear here once one has been created."
      />
      <p className="muted report-note">
        Households, residents and units released are counted through the household that records the barangay. Assessment
        figures cover the selected period; the household and resident counts do not. Every barangay this account can
        read is listed, whichever one the filter is set to — comparing them is what this panel is for.
      </p>
    </Card>
  );
}

/**
 * How much of the register has been reached, which is a different question from
 * what the assessments found. Counts distinct residents, not assessments.
 */
function CoveragePanel({ stats, filters, scope }: { stats: BarangayStats[] } & PanelProps) {
  const ranked = [...stats].filter((row) => row.residents > 0).sort((a, b) => (b.coverageRate ?? 0) - (a.coverageRate ?? 0));

  return (
    <Card className="activity-card report-card" as="article">
      <PanelHead
        title="Assessment coverage"
        onExport={() => exportReport(contextFor('Assessment Coverage', { filters, scope }), stats, comparisonColumns)}
      />
      <SummaryContext filters={filters} extra={scope} />
      {/* A ring per barangay, ordered by coverage, so the gaps are the emptiest
          rings and a reader finds them by shape before reading a number. One
          hue across all of them: this is a magnitude, and a colour per barangay
          would imply an identity the figure does not carry. */}
      {ranked.length ? (
        <div className="gauge-grid">
          {ranked.map((row) => (
            <GaugeRing
              key={row.barangayId || 'unassigned'}
              value={row.residentsAssessed}
              total={row.residents}
              label={row.name}
              caption={`${row.residentsAssessed} of ${row.residents} residents`}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No registered residents" text="Coverage is a share of the residents on file." />
      )}
      <p className="muted report-note">
        Share of each barangay&apos;s registered residents with at least one assessment in this period. A low bar is a
        profiling gap, not a health finding. Every barangay this account can read gets a ring, whichever one the filter
        is set to.
      </p>
    </Card>
  );
}

const utilizationColumns: CsvColumn<ItemUtilization>[] = [
  { header: 'Item', value: (row) => row.itemName },
  { header: 'Type', value: (row) => titleCase(row.type) },
  { header: 'Unallocated at barangay', value: (row) => row.onHand },
  { header: 'Allocated to BHWs (all time)', value: (row) => row.allocated },
  { header: 'Released in period', value: (row) => row.releasedInPeriod },
  { header: 'Reorder level', value: (row) => row.reorderLevel },
];

/** Where each item's stock sits, and how much of it moved in the period. */
function UtilizationPanel({ snapshot, filters, scope }: { snapshot: AdminSnapshot } & PanelProps) {
  const rows = supplyUtilization(snapshot);
  // Two charts: the ring is where the stock stands now, the bars are what moved
  // in the period. One scale would read as if one were the remainder of the other.
  const moved = rows.filter((row) => row.releasedInPeriod > 0);
  const position: Tally[] = [
    { label: 'unallocated', count: rows.reduce((sum, row) => sum + row.onHand, 0) },
    { label: 'with BHWs', count: rows.reduce((sum, row) => sum + row.allocated, 0) },
  ];
  const positionColors: Record<string, string> = {
    unallocated: SERIES_COLORS[0],
    'with BHWs': SERIES_COLORS[2],
  };
  const columns: TableColumn<ItemUtilization>[] = [
    { key: 'item', header: 'Item', render: (row) => row.itemName },
    { key: 'on-hand', header: 'Unallocated', render: (row) => row.onHand },
    { key: 'allocated', header: 'With BHWs', render: (row) => row.allocated },
    { key: 'released', header: 'Released', render: (row) => row.releasedInPeriod },
  ];

  return (
    <Card className="activity-card report-card report-card-wide" as="article">
      <PanelHead
        title="Supply utilization"
        onExport={() => exportReport(contextFor('Supply Utilization', { filters, scope }), rows, utilizationColumns)}
      />
      <SummaryContext filters={filters} extra={scope} />
      {/* Ring left, bars right, on one row. The ring is where the stock stands
          and the bars are what moved, and stacking them left the ring's row half
          empty. Each half keeps its own guard, and a lone survivor takes the
          whole row rather than sitting in the narrow column. */}
      <div className="chart-split">
        {position.some((row) => row.count) ? (
          <div>
            <h4>Where the stock sits</h4>
            <DonutChart rows={position} colorFor={(row) => positionColors[row.label]} unit="units">
              <ul className="chart-breakdown">
                {position.map((row) => (
                  <li key={row.label}>
                    <span className="chart-swatch" style={{ background: positionColors[row.label] }} aria-hidden="true" />
                    <span>{titleCase(row.label)}</span>
                    <strong>{row.count}</strong>
                  </li>
                ))}
              </ul>
            </DonutChart>
          </div>
        ) : null}
        {moved.length ? (
          <div>
            <h4>Released in period</h4>
            <BarChart
              rows={moved.map((row) => ({ key: row.itemId, label: row.itemName, values: [row.releasedInPeriod] }))}
              series={[{ label: 'Units released', color: SERIES_COLORS[1] }]}
            />
          </div>
        ) : null}
      </div>
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.itemId}
        emptyTitle="No inventory items"
        emptyText="Items created for this barangay appear here."
      />
      <p className="muted report-note">
        Unallocated is what the barangay still holds; &ldquo;with BHWs&rdquo; is everything ever handed out, so the two
        do not sum to a stock figure and neither is period-scoped. Released counts the selected period only.
      </p>
    </Card>
  );
}
