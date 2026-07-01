import { EmptyState } from '../common/EmptyState';
import { TableWrapper } from '../common/TableWrapper';

export function AccountsTable() {
  return (
    <TableWrapper>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Assigned Purok</th>
            <th>Status</th>
          </tr>
        </thead>
      </table>
      <EmptyState title="No local account rows" text="Account management is prepared for admin data without changing authentication logic." />
    </TableWrapper>
  );
}
