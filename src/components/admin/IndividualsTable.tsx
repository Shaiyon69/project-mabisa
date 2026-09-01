import { useEffect, useState } from 'react';
import type { Individual } from '../../types/database';
import { ageInYears, formatDate, titleCase } from '../../lib/utils';
import { buildReportCsv, downloadCsv, reportFileName, type CsvColumn } from '../../lib/csv';
import { fetchBarangayScope, fetchResidentPage, readAllResidentPages } from '../../services/adminData';
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
    key: 'status',
    header: 'Membership',
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
  { header: 'Household head', value: (row) => (row.is_household_head ? 'Yes' : 'No') },
  { header: 'Relationship to head', value: (row) => (row.relationship_to_head ? titleCase(row.relationship_to_head) : '') },
  { header: 'Membership', value: (row) => titleCase(row.status ?? 'active') },
  { header: 'Membership changed on', value: (row) => row.status_changed_on },
  { header: 'Last updated', value: (row) => row.updated_at },
];

/**
 * The central resident registry. Reads Supabase, not this browser's SQLite
 * mirror — search, paging and the total are all resolved server-side, so the
 * registry isn't bounded by what one page happened to download.
 */
export function IndividualsTable() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ rows: Individual[]; total: number; error: string | null; settledFor: string }>({
    rows: [],
    total: 0,
    error: null,
    settledFor: '',
  });

  // `loading` is derived from this key, not its own state, so a keystroke marks the table busy immediately.
  const requestKey = `${query}|${page}`;
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
      fetchResidentPage(query, ITEMS_PER_PAGE, (page - 1) * ITEMS_PER_PAGE)
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
  }, [query, page, requestKey]);

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE) || 1;

  /**
   * Exports the whole filtered set, refetched a page at a time, not just the ten
   * rows on screen. One oversized range would be trimmed to the server's cap and
   * the file would print its own row count as though it were complete.
   */
  async function exportResidents() {
    const [rows, barangay] = await Promise.all([
      readAllResidentPages((offset) => fetchResidentPage(query, PULL_PAGE_SIZE, offset)),
      fetchBarangayScope(),
    ]);

    downloadCsv(
      reportFileName('Resident Registry'),
      buildReportCsv(
        {
          title: 'Resident Registry',
          barangay,
          from: 'all dates',
          to: 'all dates',
          filters: query.trim() ? [{ label: 'Search', value: query.trim() }] : [],
        },
        rows,
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
