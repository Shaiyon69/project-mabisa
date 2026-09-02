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
    // Joined in from the household, which is the only row that records it. A
    // resident whose household carries no barangay is a backfill gap, and saying
    // so is more useful than an empty cell.
    render: (individual) => individual.barangay_name || 'Unassigned',
  },
  {
    key: 'status',
    header: 'Membership',
    // The dashboard's resident count filters on `status` and this registry does
    // not, so the two disagree by everyone who moved out. Naming the column is
    // what makes that difference readable rather than a discrepancy.
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
 * The central resident registry.
 *
 * Reads Supabase, not this browser's SQLite mirror: on an LGU workstation that
 * mirror is empty, and on a shared machine it holds whatever the last field
 * device left behind — which is exactly the FR-06 defect. Search, paging and the
 * total are all resolved server-side, so the registry is not bounded by what one
 * page happened to download.
 *
 * The "Pending Sync" column is gone with it. It was derived from this browser's
 * own queue length and applied to every row alike, so on the portal it said
 * nothing about the record it sat beside.
 *
 * The barangay and purok narrow the registry through the household, which is the
 * only row that records either. Sex, age band and membership are columns on the
 * resident itself. All five come from the page's filter bar rather than controls
 * of their own, so the scope an officer chose on the dashboard is still in force
 * on the list they drilled into — and every one of them is resolved server-side,
 * alongside the search and the paging.
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

  // Arrived here from a dashboard bar. The band and the period that produced it
  // both come from the link, so the list answers the same question the bar did
  // rather than a similar one over a different range.
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

  // Back to page 1 when the drawer's filters change. They cannot go through a
  // handler here — they arrive from the URL, changed by a control on another
  // component — so this is the adjust-state-during-render pattern rather than
  // an effect: React discards this render and restarts before anything is
  // committed, so no request ever goes out at the stale offset. Narrowing to
  // one purok while on page 4 of the whole registry would otherwise render an
  // empty table reading "Page 4 of 1", which looks like a purok with no
  // residents rather than a page that no longer exists.
  const scopeKey = FILTER_PARAMS.map(([key]) => filters[key] ?? '').join('|');
  const [pagedScope, setPagedScope] = useState(scopeKey);

  if (pagedScope !== scopeKey) {
    setPagedScope(scopeKey);
    setPage(1);
  }

  // What this render is asking for. `loading` is derived from it rather than
  // held in its own state, so a keystroke marks the table busy on the same
  // render that changed the query. Every narrow filter is read off
  // `FILTER_PARAMS` rather than named here: a filter this key misses is one
  // that changes the request without ever triggering a refetch.
  const requestKey = [
    query,
    page,
    ...FILTER_PARAMS.map(([key]) => filters[key] ?? 'all'),
    statusFilter ? `${statusFilter.status}:${statusFilter.from}:${statusFilter.to}` : '',
  ].join('|');
  const scopeName = describeScope(filters, snapshot);
  const { rows, total, error } = result;
  const loading = result.settledFor !== requestKey;

  // Reset to page 1 in the handler rather than an effect on [query], so the page
  // never renders with a stale offset.
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
   * Exports the whole filtered set, not the ten rows on screen — an export whose
   * totals disagree with the count above it is the failure FR-09 names. Asking
   * for `total` rows in one call would not have done it: the server caps a
   * response below that and truncates silently.
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
          // Every filter that narrowed the rows, named on the file. A preamble
          // that lists the barangay but not the age band describes a wider set
          // than the file holds, which is the FR-09 failure in a subtler form
          // than a truncated export.
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
