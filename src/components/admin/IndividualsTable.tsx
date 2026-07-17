// Goal: Implement true SQLite-level pagination using OFFSET and LIMIT 
// to navigate through large datasets without memory bloat.

import { useEffect, useState } from 'react';
import type { Individual } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { FormField } from '../common/FormField';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';
import { Button } from '../common/Button'; // Assuming you have this from your forms
import { readLocalIndividuals, getIndividualCount } from '../../services/localDatabase';

type IndividualsTableProps = {
  pendingQueueCount: number;
};

const ITEMS_PER_PAGE = 10;

export function IndividualsTable({ pendingQueueCount }: IndividualsTableProps) {
  const [query, setQuery] = useState('');
  const [tableRows, setTableRows] = useState<Individual[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  
  // 1. Add state to track the current page
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
      header: 'Household', // Changed header to be cleaner
      render: (individual) => individual.household_number || 'Unassigned', // Now renders HH-0001
    },
    {
      key: 'status',
      header: 'Status',
      render: () => <TableBadge label={pendingQueueCount ? 'Pending Sync' : 'Synced'} tone={pendingQueueCount ? 'warning' : 'success'} />,
    },
  ];

  // 2. Reset to page 1 whenever the user types a new search query
  useEffect(() => {
    setPage(1);
  }, [query]);

  // 3. Fetch data, re-running whenever the query OR the page changes
  useEffect(() => {
    getIndividualCount().then(setTotalCount).catch(console.error);
    
    const timeoutId = setTimeout(() => {
      // Calculate how many rows to skip based on the current page
      const currentOffset = (page - 1) * ITEMS_PER_PAGE;

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

  // Calculate total pages for our button logic
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <FormField label="Search residents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or address" />
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

      {/* 4. Add the Pagination Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0' }}>
        <Button 
          disabled={page === 1} 
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        
        <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
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