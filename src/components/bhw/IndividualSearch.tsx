import { useMemo, useState } from 'react';
import type { Individual } from '../../types/database';
import { FormField, SelectField } from '../common/FormField';

type IndividualSearchProps = {
  individuals: Individual[];
  selectedResidentId: string;
  onChange: (residentId: string) => void;
};

export function IndividualSearch({ individuals, selectedResidentId, onChange }: IndividualSearchProps) {
  const [query, setQuery] = useState('');
  
  const filteredIndividuals = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return individuals;
    }

    // Filter based on the new first_name and last_name properties
    return individuals.filter((person) => 
      `${person.first_name} ${person.last_name}`.toLowerCase().includes(search)
    );
  }, [query, individuals]);

  return (
    <>
      <FormField
        label="Search Profile"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name"
        disabled={!individuals.length}
      />
      <SelectField 
        label="Individual" 
        value={selectedResidentId} 
        onChange={(event) => onChange(event.target.value)} 
        required 
        disabled={!individuals.length}
      >
        {filteredIndividuals.map((person) => (
          <option key={person.resident_id} value={person.resident_id}>
            {person.last_name}, {person.first_name} {person.is_household_head ? '(Head)' : ''}
          </option>
        ))}
      </SelectField>
    </>
  );
}