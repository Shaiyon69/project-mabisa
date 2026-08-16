import { useEffect, useState } from 'react';
import type { Individual } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { FormField } from '../common/FormField';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';
import { Button } from '../common/Button';
import { readLocalIndividuals, getIndividualCount } from '../../services/localDatabase';

type IndividualsTableProps = {
  pendingQueueCount: number;
};

const ITEMS_PER_PAGE = 10;

export function IndividualsTable({ pendingQueueCount }: IndividualsTableProps) {
  const [query, setQuery] = useState('');
  const [tableRows, setTableRows] = useState<Individual[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  
  const [page, setPage] = useState(1);

  const columns: TableColumn<Individual>[] = [
    {
      key: 'individual',
      header: 'Individual',
      render: (individual) => individual.first_name + ' ' + individual.last_name,
    },
    {
      key: 'sex',
      header: 'Sex',
      render: (individual) => titleCase(individual.sex),
    },
    {
      key: 'household_id',
      header: 'Household',
      render: (individual) => individual.household_number || 'Unassigned',
    },
    {
      key: 'status',
      header: 'Status',
      render: () => <TableBadge label={pendingQueueCount ? 'Pending Sync' : 'Synced'} tone={pendingQueueCount ? 'warning' : 'success'} />,
    },
  ];

  // 2. Reset to page 1 whenever the user types a new search query. Done in the handler
  // rather than an effect on [query], so the page never renders with a stale offset.
  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery);
    setPage(1);
  }

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const currentOffset = (page - 1) * ITEMS_PER_PAGE;

      // The count has to honour the same search term as the rows, otherwise the
      // pager offers pages the filtered result set does not have.
      getIndividualCount({ searchQuery: query }).then(setTotalCount).catch(console.error);

      readLocalIndividuals({
        searchQuery: query,
        limit: ITEMS_PER_PAGE,
        offset: currentOffset
      })
        .then(setTableRows)
        .catch(console.error);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, page]);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <FormField label="Search residents" value={query} onChange={(event) => handleQueryChange(event.target.value)} placeholder="Name or household number" />
      </TableToolbar>
      
      <Table
        columns={columns}
        rows={tableRows}
        getRowKey={(individual) => individual.resident_id}
        emptyTitle="No individual rows found"
        emptyText="Try a different search or register individuals from the BHW app."
        limit={ITEMS_PER_PAGE}
      />
      
      <TableMeta shown={tableRows.length} total={totalCount} label="individual" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0' }}>
        <Button 
          disabled={page === 1} 
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        
        {/* --text-muted has never existed; the token is --muted. */}
        <span className="muted">
          Page {page} of {totalPages}
        </span>
        
        <Button 
          disabled={page >= totalPages} 
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
