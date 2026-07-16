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
    if (!search) return individuals;

    return individuals.filter((person) => {
      const fullName = `${person.first_name} ${person.middle_name || ''} ${person.last_name}`.toLowerCase();
      return fullName.includes(search);
    });
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
        {filteredIndividuals.map((person) => {
          const mi = person.middle_name ? ` ${person.middle_name.charAt(0)}.` : '';
          
          return (
            <option key={person.resident_id} value={person.resident_id}>
              {person.last_name}, {person.first_name}{mi} {person.is_household_head ? '(Head)' : ''}
            </option>
          );
        })}
      </SelectField>
    </>
  );
}