import { Table, type TableColumn } from '../common/Table';

type AccountRow = {
  id: string;
  name: string;
  role: string;
  assignedPurok: string;
  status: string;
};

const columns: TableColumn<AccountRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (account) => account.name,
  },
  {
    key: 'role',
    header: 'Role',
    render: (account) => account.role,
  },
  {
    key: 'assigned-purok',
    header: 'Assigned Purok',
    render: (account) => account.assignedPurok,
  },
  {
    key: 'status',
    header: 'Status',
    render: (account) => account.status,
  },
];

export function AccountsTable() {
  return (
    <Table
      columns={columns}
      rows={[]}
      getRowKey={(account) => account.id}
      emptyTitle="No local account rows"
      emptyText="Account management is prepared for admin data without changing authentication logic."
    />
  );
}
