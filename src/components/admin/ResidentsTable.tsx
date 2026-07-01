import { useMemo, useState } from 'react';
import type { Resident } from '../../types/database';
import { titleCase } from '../../lib/utils';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { Input } from '../common/Input';
import { TableWrapper } from '../common/TableWrapper';

type ResidentsTableProps = {
  residents: Resident[];
  pendingQueueCount: number;
};

export function ResidentsTable({ residents, pendingQueueCount }: ResidentsTableProps) {
  const [query, setQuery] = useState('');
  const filteredResidents = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return residents;
    }

    return residents.filter((resident) => `${resident.name} ${resident.sex} ${resident.address}`.toLowerCase().includes(search));
  }, [query, residents]);

  return (
    <div className="table-stack">
      <Input label="Search residents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, sex, or address" />
      <TableWrapper>
        <table>
          <thead>
            <tr>
              <th>Resident</th>
              <th>Sex</th>
              <th>Address</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredResidents.slice(0, 10).map((resident) => (
              <tr key={resident.resident_id}>
                <td>{resident.name}</td>
                <td>{titleCase(resident.sex)}</td>
                <td>{resident.address}</td>
                <td>
                  <Badge label={pendingQueueCount ? 'Pending Sync' : 'Synced'} tone={pendingQueueCount ? 'warning' : 'success'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredResidents.length ? <EmptyState title="No resident rows" text="Try a different search or register residents from the BHW app." /> : null}
      </TableWrapper>
      <p className="table-meta">Showing {Math.min(filteredResidents.length, 10)} of {filteredResidents.length} local resident row(s).</p>
    </div>
  );
}
