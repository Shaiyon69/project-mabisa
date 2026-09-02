import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Individual, NutritionStatus } from '../../types/database';
import { ageInYears, formatDate, titleCase } from '../../lib/utils';
import { buildReportCsv, downloadCsv, reportFileName, type CsvColumn } from '../../lib/csv';
import {
  FILTER_PARAMS,
  NUTRITION_ORDER,
  describeScope,
  fetchBarangayScope,
  fetchResidentPage,
  readAllResidentPages,
  type AdminFilters,
  type AdminSnapshot,
  type ResidentStatusFilter,
} from '../../services/adminData';
import { PULL_PAGE_SIZE } from '../../lib/supabase';
import { Button } from '../common/Button';
import { FormField } from '../common/FormField';
import { ErrorState } from '../common/StateMessage';
import { Table, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

const ITEMS_PER_PAGE = 10;

const columns: TableColumn<Individual>[] = [
  {
    key: 'individual',
    header: 'Individual',
    render: (individual) => `${individual.first_name} ${individual.last_name}`,
  },
  {
    key: 'sex',
    header: 'Sex',
    render: (individual) => titleCase(individual.sex),
  },
  {
    key: 'age',
    header: 'Age',
    render: (individual) => ageInYears(individual.birthday) ?? '—',
  },
  {
    key: 'household_id',
    header: 'Household',
    render: (individual) => individual.household_number || 'Unassigned',
  },
  {
    key: 'barangay',
    header: 'Barangay',
    // Joined in from the household, the only row that records it. A missing one
    // is a backfill gap, so it is named rather than left blank.
    render: (individual) => individual.barangay_name || 'Unassigned',
  },
  {
    key: 'status',
    header: 'Membership',
    // The dashboard's resident count filters on `status` and this registry does
    // not, so the column is named to make the difference readable.
    render: (individual) =>
      !individual.status || individual.status === 'active' ? 'Active' : titleCase(individual.status),
  },
  {
    key: 'updated',
    header: 'Last updated',
    render: (individual) => formatDate(individual.updated_at),
  },
];

const exportColumns: CsvColumn<Individual>[] = [
  { header: 'Resident ID', value: (row) => row.resident_id },
  { header: 'Last name', value: (row) => row.last_name },
  { header: 'First name', value: (row) => row.first_name },
  { header: 'Middle name', value: (row) => row.middle_name },
  { header: 'Sex', value: (row) => titleCase(row.sex) },
  { header: 'Birthday', value: (row) => row.birthday },
  { header: 'Age', value: (row) => ageInYears(row.birthday) },
  { header: 'Household number', value: (row) => row.household_number },
  { header: 'Barangay', value: (row) => row.barangay_name },
  { header: 'Household head', value: (row) => (row.is_household_head ? 'Yes' : 'No') },
  { header: 'Relationship to head', value: (row) => (row.relationship_to_head ? titleCase(row.relationship_to_head) : '') },
  { header: 'Last updated', value: (row) => row.updated_at },
];

/**
 * The central resident registry. Reads Supabase rather than this browser's SQLite
 * mirror, which on a workstation is empty, and resolves search, paging and the
 * total server-side.
 *
 * Barangay and purok narrow through the household, the only row that records
 * either; sex, age band and membership are columns on the resident. All five come
 * from the page's filter bar, so a scope chosen on the dashboard still holds here.
 */
type IndividualsTableProps = {
  filters: AdminFilters;
  /** Only to name the active scope in the caption and the export preamble. */
  snapshot: Pick<AdminSnapshot, 'barangays' | 'puroks'>;
};

export function IndividualsTable({ filters, snapshot }: IndividualsTableProps) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  // Arrived from a dashboard bar: the band and its period both come from the
  // link, so the list answers the same question the bar did.
  const statusFilter = useMemo<ResidentStatusFilter | undefined>(() => {
    const status = params.get('status');
    const from = params.get('from');
    const to = params.get('to');

    if (!status || !from || !to || !NUTRITION_ORDER.includes(status as NutritionStatus)) {
      return undefined;
    }

    return { status: status as NutritionStatus, from, to };
  }, [params]);

  function clearStatusFilter() {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);

        updated.delete('status');

        return updated;
      },
      { replace: true },
    );
    setPage(1);
  }
  const [result, setResult] = useState<{ rows: Individual[]; total: number; error: string | null; settledFor: string }>({
    rows: [],
    total: 0,
    error: null,
    settledFor: '',
  });

  // Back to page 1 when the drawer's filters change. They arrive from the URL
  // rather than a handler here, so this adjusts state during render: React
  // restarts before committing, and no request goes out at the stale offset.
  const scopeKey = FILTER_PARAMS.map(([key]) => filters[key] ?? '').join('|');
  const [pagedScope, setPagedScope] = useState(scopeKey);

  if (pagedScope !== scopeKey) {
    setPagedScope(scopeKey);
    setPage(1);
  }

  // What this render is asking for. `loading` is derived from it, so a keystroke
  // marks the table busy on the same render. Filters are read off `FILTER_PARAMS`:
  // one this key misses changes the request without triggering a refetch.
  const requestKey = [
    query,
    page,
    ...FILTER_PARAMS.map(([key]) => filters[key] ?? 'all'),
    statusFilter ? `${statusFilter.status}:${statusFilter.from}:${statusFilter.to}` : '',
  ].join('|');
  const scopeName = describeScope(filters, snapshot);
  const { rows, total, error } = result;
  const loading = result.settledFor !== requestKey;

  // Reset to page 1 in the handler, so the page never renders at a stale offset.
  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery);
    setPage(1);
  }

  useEffect(() => {
    let current = true;

    const timeoutId = setTimeout(() => {
      fetchResidentPage(query, ITEMS_PER_PAGE, (page - 1) * ITEMS_PER_PAGE, filters, statusFilter)
        .then((next) => {
          if (current) {
            setResult({ rows: next.rows, total: next.total, error: null, settledFor: requestKey });
          }
        })
        .catch((cause: unknown) => {
          if (current) {
            setResult((previous) => ({
              ...previous,
              error: cause instanceof Error ? cause.message : 'Could not read the resident registry.',
              settledFor: requestKey,
            }));
          }
        });
    }, 300);

    return () => {
      current = false;
      clearTimeout(timeoutId);
    };
  }, [query, page, statusFilter, filters, requestKey]);

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE) || 1;

  /**
   * Exports the whole filtered set, not the rows on screen. Paged, since asking
   * for `total` rows in one call is capped and truncated silently.
   */
  async function exportResidents() {
    const [all, barangay] = await Promise.all([
      readAllResidentPages((offset) => fetchResidentPage(query, PULL_PAGE_SIZE, offset, filters, statusFilter)),
      fetchBarangayScope(),
    ]);

    downloadCsv(
      reportFileName('Resident Registry'),
      buildReportCsv(
        {
          title: 'Resident Registry',
          barangay,
          // The band is assessed over a period; an unfiltered registry is not.
          from: statusFilter?.from ?? 'all dates',
          to: statusFilter?.to ?? 'all dates',
          // Every filter that narrowed the rows, named on the file, so the
          // preamble never describes a wider set than the file holds.
          filters: [
            ...(query.trim() ? [{ label: 'Search', value: query.trim() }] : []),
            ...(statusFilter ? [{ label: 'Nutrition status', value: titleCase(statusFilter.status) }] : []),
            { label: 'Area', value: scopeName },
            ...(filters.sex ? [{ label: 'Sex', value: titleCase(filters.sex) }] : []),
            ...(filters.ageBand ? [{ label: 'Age band', value: filters.ageBand }] : []),
            ...(filters.membership ? [{ label: 'Membership', value: titleCase(filters.membership) }] : []),
          ],
        },
        all,
        exportColumns,
      ),
    );
  }

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <FormField
          label="Search residents"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Name or household number"
        />
        <Button variant="ghost" onClick={() => void exportResidents()} disabled={loading || !total}>
          Export CSV
        </Button>
      </TableToolbar>

      {/* The filter arrived in a link, so it has to be visible and removable on
          the screen it lands on — otherwise a partial registry looks like the
          whole one, which is the worst way a drill-down can fail. */}
      {statusFilter ? (
        <div className="filter-chip">
          <span>
            Nutrition status <strong>{titleCase(statusFilter.status)}</strong>, assessed {formatDate(statusFilter.from)} –{' '}
            {formatDate(statusFilter.to)}
          </span>
          <Button variant="ghost" onClick={clearStatusFilter}>
            Clear
          </Button>
        </div>
      ) : null}

      {error ? <ErrorState title="Could not read the resident registry" text={error} /> : null}

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(individual) => individual.resident_id}
        emptyTitle={loading ? 'Reading the central registry' : 'No individual rows found'}
        emptyText={loading ? 'One moment.' : 'Try a different search, or wait for a field device to sync.'}
        limit={ITEMS_PER_PAGE}
      />

      <TableMeta shown={rows.length} total={total} label="central individual" />

      <div className="admin-pager">
        <Button disabled={page === 1 || loading} onClick={() => setPage((current) => current - 1)}>
          Previous
        </Button>
        <span className="muted">
          Page {page} of {totalPages}
        </span>
        <Button disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
