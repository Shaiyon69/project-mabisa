import { useMemo, useState } from 'react';
import type { Individual } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { FormField } from '../common/FormField';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

type IndividualsTableProps = {
  individuals: Individual[];
  pendingQueueCount: number;
};

export function IndividualsTable({ individuals, pendingQueueCount }: IndividualsTableProps) {
  const [query, setQuery] = useState('');
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
      header: 'Household ID',
      render: (individual) => individual.household_id,
    },
    {
      key: 'status',
      header: 'Status',
      render: () => <TableBadge label={pendingQueueCount ? 'Pending Sync' : 'Synced'} tone={pendingQueueCount ? 'warning' : 'success'} />,
    },
  ];
  const filteredIndividuals = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return individuals;
    }

    return individuals.filter((individual) => `${individual.first_name} ${individual.last_name} ${individual.sex} ${individual.household_id}`.toLowerCase().includes(search));
  }, [query, individuals]);

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <FormField label="Search residents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, sex, or address" />
      </TableToolbar>
      <Table
        columns={columns}
        rows={filteredIndividuals}
        getRowKey={(individual) => individual.resident_id}
        emptyTitle="No individual rows"
        emptyText="Try a different search or register individuals from the BHW app."
        limit={10}
      />
      <TableMeta shown={Math.min(filteredIndividuals.length, 10)} total={filteredIndividuals.length} label="individual" />
    </div>
  );
}
