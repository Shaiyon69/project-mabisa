import { useMemo } from 'react';
import { NUTRITION_COLORS, SERIES_COLORS } from '../../lib/charts';
import { formatCount, titleCase } from '../../lib/utils';
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
  rankByUnderweight,
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
import { Table, TableMeta, type TableColumn } from '../common/Table';
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
  // Held across a render that changed neither: this walks every household,
  // resident, assessment and release the account can read, and the sixty-second
  // re-read bumps its token before the rows it asks for come back.
  const stats = useMemo(
    () => barangayStats(snapshot.unscoped, snapshot.sessionBarangayId),
    [snapshot.unscoped, snapshot.sessionBarangayId],
  );
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

/** Rings drawn before the grid stops being scannable. The comparison table lists every barangay. */
const COVERAGE_RINGS = 12;

/**
 * Items a supply panel draws before deferring to the Inventory screen. An item row
 * carries a barangay, so an RHU account reads all sixty-four barangays' stock here.
 */
const SUPPLY_ROWS = 12;

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
  // The chart's own figures. A line carries its numbers in a hover, which a
  // phone has no way to ask for — and the note below has always promised a table.
  const columns: TableColumn<TrendPoint>[] = [
    { key: 'month', header: 'Month', render: (row) => row.label },
    { key: 'assessments', header: 'Assessments', numeric: true, render: (row) => row.assessments },
    { key: 'underweight', header: 'Underweight', numeric: true, render: (row) => row.underweight },
    { key: 'rate', header: 'Underweight rate', numeric: true, render: (row) => percent(row.rate) },
  ];

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
          text="Try a wider date range, or wait for a health worker's phone to send its records."
        />
      )}
      {recorded ? (
        <Table
          columns={columns}
          rows={points}
          getRowKey={(row) => row.month}
          emptyTitle="No assessments in this period"
          emptyText="Months appear here once a health worker's phone has sent its records."
        />
      ) : null}
      <p className="muted report-note">
        A month at zero had nothing recorded, not nothing found.
      </p>
    </Card>
  );
}

const coverageColumns: CsvColumn<BarangayStats>[] = [
  { header: 'Barangay', value: (row) => row.name },
  { header: 'Residents', value: (row) => row.residents },
  { header: 'Residents assessed', value: (row) => row.residentsAssessed },
  { header: 'Coverage', value: (row) => (row.coverageRate === null ? '' : `${Math.round(row.coverageRate * 100)}%`) },
];

/** `mix` carries each barangay's four band counts in `NUTRITION_ORDER`. */
const comparisonColumns = (mix: Map<string, number[]>): CsvColumn<BarangayStats>[] => [
  { header: 'Barangay', value: (row) => row.name },
  { header: 'Households', value: (row) => row.households },
  { header: 'Residents', value: (row) => row.residents },
  { header: 'Assessments in period', value: (row) => row.assessments },
  { header: 'Underweight', value: (row) => row.underweight },
  ...NUTRITION_ORDER.slice(1).map((status, index) => ({
    header: titleCase(status),
    value: (row: BarangayStats) => mix.get(row.barangayId)?.[index + 1] ?? 0,
  })),
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
        Counts active residents on the register right now.
      </p>
    </Card>
  );
}

const stockColumns: CsvColumn<Tally>[] = [
  { header: 'Item type', value: (row) => titleCase(row.label) },
  { header: 'Units at the barangay', value: (row) => row.count },
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
                series={[{ label: 'Units at the barangay', color: SERIES_COLORS[1] }]}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState title="Nothing stocked yet" text="A barangay administrator adds supplies from the Inventory screen." />
      )}
      <p className="muted report-note">
        Unallocated stock only — not what health workers are carrying.
      </p>
    </Card>
  );
}

/**
 * Every barangay side by side, as one table. It was two grouped bar charts over
 * the same table: at 75px and 89px of chart per barangay they cost more height
 * than every figure they drew, and the three series of the first were three of
 * these columns. The nutrition bands moved into the table rather than going with
 * them, so the panel lost no figure at all.
 */
function ComparisonPanel({
  snapshot,
  stats,
  filters,
  scope,
}: { snapshot: AdminSnapshot; stats: BarangayStats[] } & PanelProps) {
  // Values run in `NUTRITION_ORDER`, underweight first — the column below reads
  // the last three, the existing underweight column already carrying the first.
  // A second walk of the same rows, so it is held on the same terms as `stats`.
  const mix = useMemo(
    () =>
      new Map(
        nutritionByBarangay(snapshot.unscoped, snapshot.sessionBarangayId).map((row) => [row.key ?? '', row.values]),
      ),
    [snapshot.unscoped, snapshot.sessionBarangayId],
  );
  const bandOf = (row: BarangayStats, index: number) => mix.get(row.barangayId)?.[index] ?? 0;
  const columns: TableColumn<BarangayStats>[] = [
    { key: 'name', header: 'Barangay', render: (row) => row.name },
    { key: 'households', header: 'Households', numeric: true, render: (row) => row.households },
    { key: 'residents', header: 'Residents', numeric: true, render: (row) => row.residents },
    { key: 'assessments', header: 'Assessments', numeric: true, render: (row) => row.assessments },
    {
      key: 'underweight',
      header: 'Underweight',
      numeric: true,
      render: (row) => `${percent(row.underweightRate)} (${formatCount(row.underweight)})`,
    },
    ...NUTRITION_ORDER.slice(1).map((status, index) => ({
      key: status,
      header: titleCase(status),
      numeric: true,
      render: (row: BarangayStats) => bandOf(row, index + 1),
    })),
    { key: 'released', header: 'Units released', numeric: true, render: (row) => row.unitsReleased },
  ];

  return (
    <Card className="activity-card report-card report-card-wide" as="article">
      <PanelHead
        title="Barangay comparison"
        onExport={() =>
          exportReport(contextFor('Barangay Comparison', { filters, scope }), stats, comparisonColumns(mix))
        }
      />
      <SummaryContext filters={filters} extra={scope} />
      <Table
        columns={columns}
        rows={rankByUnderweight(stats)}
        getRowKey={(row) => row.barangayId || 'unassigned'}
        emptyTitle="No barangays"
        emptyText="Barangay records appear here once one has been created."
      />
      <p className="muted report-note">
        Worst underweight share first.
      </p>
    </Card>
  );
}

/**
 * How much of the register has been reached, which is a different question from
 * what the assessments found. Counts distinct residents, not assessments.
 */
function CoveragePanel({ stats, filters, scope }: { stats: BarangayStats[] } & PanelProps) {
  // Emptiest first: a gap is what this panel is for, and at sixty-four barangays
  // the best-covered ones pushed it off the bottom of the grid.
  const ranked = [...stats].filter((row) => row.residents > 0).sort((a, b) => (a.coverageRate ?? 0) - (b.coverageRate ?? 0));
  const shown = ranked.slice(0, COVERAGE_RINGS);
  const hidden = ranked.length - shown.length;

  return (
    <Card className="activity-card report-card" as="article">
      <PanelHead
        title="Assessment coverage"
        onExport={() => exportReport(contextFor('Assessment Coverage', { filters, scope }), ranked, coverageColumns)}
      />
      <SummaryContext filters={filters} extra={scope} />
      {/* A ring per barangay, emptiest first, so the gaps are the first rings read
          and a reader finds them by shape before reading a number. One hue across
          all of them: this is a magnitude, and a colour per barangay would imply
          an identity the figure does not carry. */}
      {shown.length ? (
        <div className="gauge-grid">
          {shown.map((row) => (
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
        A thin ring is a profiling gap, not a health finding.
        {hidden > 0 ? ` Emptiest ${shown.length} of ${ranked.length} drawn; the table carries every one.` : ''}
      </p>
    </Card>
  );
}

const utilizationColumns: CsvColumn<ItemUtilization>[] = [
  { header: 'Item', value: (row) => row.itemName },
  { header: 'Type', value: (row) => titleCase(row.type) },
  { header: 'At the barangay', value: (row) => row.onHand },
  { header: 'Given to health workers (all time)', value: (row) => row.allocated },
  { header: 'Released in period', value: (row) => row.releasedInPeriod },
  { header: 'Reorder level', value: (row) => row.reorderLevel },
];

/**
 * The two halves of the stock position, each with the colour its segment and its
 * swatch are drawn in. One list so a renamed label cannot strand its colour —
 * which is what left both segments undefined and unpainted.
 */
const POSITIONS: { label: string; color: string; of: (row: ItemUtilization) => number }[] = [
  { label: 'at the barangay', color: SERIES_COLORS[0], of: (row) => row.onHand },
  { label: 'with health workers', color: SERIES_COLORS[2], of: (row) => row.allocated },
];

/** Where each item's stock sits, and how much of it moved in the period. */
function UtilizationPanel({ snapshot, filters, scope }: { snapshot: AdminSnapshot } & PanelProps) {
  const rows = supplyUtilization(snapshot);
  // Two charts: the ring is where the stock stands now, the bars are what moved
  // in the period. One scale would read as if one were the remainder of the other.
  // Busiest first and capped: every barangay's items land in this one list, so the
  // full register belongs on the Inventory screen and in the export, not here.
  const busiest = [...rows].sort((a, b) => b.releasedInPeriod - a.releasedInPeriod || b.onHand - a.onHand);
  const moved = busiest.filter((row) => row.releasedInPeriod > 0).slice(0, SUPPLY_ROWS);
  const position: Tally[] = POSITIONS.map(({ label, of }) => ({
    label,
    count: rows.reduce((sum, row) => sum + of(row), 0),
  }));
  const colorFor = (row: Tally) => POSITIONS.find((entry) => entry.label === row.label)?.color ?? SERIES_COLORS[0];
  const columns: TableColumn<ItemUtilization>[] = [
    { key: 'item', header: 'Item', render: (row) => row.itemName },
    { key: 'on-hand', header: 'At the barangay', numeric: true, render: (row) => row.onHand },
    { key: 'allocated', header: 'With health workers', numeric: true, render: (row) => row.allocated },
    { key: 'released', header: 'Released', numeric: true, render: (row) => row.releasedInPeriod },
  ];

  return (
    <Card className="activity-card report-card report-card-wide" as="article">
      <PanelHead
        title="How supplies are used"
        onExport={() => exportReport(contextFor('Supply Utilization', { filters, scope }), busiest, utilizationColumns)}
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
            <DonutChart rows={position} colorFor={(row) => colorFor(row)} unit="units">
              <ul className="chart-breakdown">
                {position.map((row) => (
                  <li key={row.label}>
                    <span className="chart-swatch" style={{ background: colorFor(row) }} aria-hidden="true" />
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
        rows={busiest}
        getRowKey={(row) => row.itemId}
        emptyTitle="No inventory items"
        emptyText="Items created for this barangay appear here."
        limit={SUPPLY_ROWS}
      />
      <TableMeta shown={Math.min(busiest.length, SUPPLY_ROWS)} total={busiest.length} label="items" />
      <p className="muted report-note">
        &ldquo;At the barangay&rdquo; and &ldquo;with health workers&rdquo; do not sum to a stock figure.
      </p>
    </Card>
  );
}
