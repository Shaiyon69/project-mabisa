import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Individual, NutritionStatus } from '../../types/database';
import { ageInYears, formatDate, titleCase } from '../../lib/utils';
import {
  FILTER_PARAMS,
  NUTRITION_ORDER,
  fetchResidentPage,
  type AdminFilters,
  type ResidentStatusFilter,
} from '../../services/adminData';
import { Button } from '../common/Button';
import { FormField } from '../common/FormField';
import { ErrorState } from '../common/StateMessage';
import { Table, TableMeta, TablePager, TableToolbar, type TableColumn } from '../common/Table';
import { useServerPage } from '../../hooks/useServerPage';

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
    numeric: true,
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
};

export function IndividualsTable({ filters }: IndividualsTableProps) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

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
  }

  const scopeKey = [
    query,
    ...FILTER_PARAMS.map(([key]) => filters[key] ?? 'all'),
    statusFilter ? `${statusFilter.status}:${statusFilter.from}:${statusFilter.to}` : '',
  ].join('|');
  const { rows, total, error, loading, page, pageCount, setPage, offset } = useServerPage(
    scopeKey,
    (limit, start) => fetchResidentPage(query, limit, start, filters, statusFilter),
    { delayMs: 300 },
  );

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <FormField
          label="Search residents"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or household number"
        />
      </TableToolbar>

      {/* The filter arrived in a link, so it has to be visible and removable on
          the screen it lands on — otherwise a partial registry looks like the
          whole one, which is the worst way a drill-down can fail.

          "At any point" is the difference from the dashboard band that links here,
          which counts each resident once under their latest check. This list is
          wider on purpose: it is who to follow up on, so someone who has since
          improved belongs on it. */}
      {statusFilter ? (
        <div className="filter-chip">
          <span>
            Assessed <strong>{titleCase(statusFilter.status)}</strong> at any point between{' '}
            {formatDate(statusFilter.from)} and {formatDate(statusFilter.to)} — including residents a later check has
            since moved to another band.
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
        busy={loading}
        emptyTitle={loading ? 'Loading the records' : 'No residents found'}
        emptyText={loading ? 'One moment.' : "Try a different search, or wait for a health worker's phone to send its records."}
        numbered
        // Paged on the server, so the count continues across pages rather than
        // restarting at one on each.
        startIndex={offset}
      />

      <TableMeta shown={rows.length} total={total} label="residents" />

      {pageCount > 1 ? <TablePager page={page} pageCount={pageCount} onPage={setPage} disabled={loading} /> : null}
    </div>
  );
}
