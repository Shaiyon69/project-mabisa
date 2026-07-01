import { useMemo, useState } from 'react';
import type { Resident } from '../../types/database';
import { Input } from '../common/Input';
import { Select } from '../common/Select';

type ResidentSearchProps = {
  residents: Resident[];
  selectedResidentId: string;
  onChange: (residentId: string) => void;
};

export function ResidentSearch({ residents, selectedResidentId, onChange }: ResidentSearchProps) {
  const [query, setQuery] = useState('');
  const filteredResidents = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return residents;
    }

    return residents.filter((resident) => `${resident.name} ${resident.address}`.toLowerCase().includes(search));
  }, [query, residents]);

  return (
    <>
      <Input
        label="Search Resident"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name or address"
        disabled={!residents.length}
      />
      <Select label="Resident" value={selectedResidentId} onChange={(event) => onChange(event.target.value)} required disabled={!residents.length}>
        {filteredResidents.map((resident) => (
          <option key={resident.resident_id} value={resident.resident_id}>
            {resident.name} • {resident.address}
          </option>
        ))}
      </Select>
    </>
  );
}
