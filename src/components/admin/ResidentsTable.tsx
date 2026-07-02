import { useMemo, useState } from 'react';
import type { Resident } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { FormField } from '../common/FormField';
import { Table, TableBadge, TableMeta, TableToolbar, type TableColumn } from '../common/Table';

type ResidentsTableProps = {
  residents: Resident[];
  pendingQueueCount: number;
};

export function ResidentsTable({ residents, pendingQueueCount }: ResidentsTableProps) {
  const [query, setQuery] = useState('');
  const columns: TableColumn<Resident>[] = [
    {
      key: 'resident',
      header: 'Resident',
      render: (resident) => resident.name,
    },
    {
      key: 'sex',
      header: 'Sex',
      render: (resident) => titleCase(resident.sex),
    },
    {
      key: 'address',
      header: 'Address',
      render: (resident) => resident.address,
    },
    {
      key: 'status',
      header: 'Status',
      render: () => <TableBadge label={pendingQueueCount ? 'Pending Sync' : 'Synced'} tone={pendingQueueCount ? 'warning' : 'success'} />,
    },
  ];
  const filteredResidents = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return residents;
    }

    return residents.filter((resident) => `${resident.name} ${resident.sex} ${resident.address}`.toLowerCase().includes(search));
  }, [query, residents]);

  return (
    <div className="ui-table-stack">
      <TableToolbar>
        <FormField label="Search residents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, sex, or address" />
      </TableToolbar>
      <Table
        columns={columns}
        rows={filteredResidents}
        getRowKey={(resident) => resident.resident_id}
        emptyTitle="No resident rows"
        emptyText="Try a different search or register residents from the BHW app."
        limit={10}
      />
      <TableMeta shown={Math.min(filteredResidents.length, 10)} total={filteredResidents.length} label="resident" />
    </div>
  );
}
