import { useEffect, useState } from 'react';
import type { Individual } from '../../types/database';
import { FormField, SelectField } from '../common/FormField';
import { readLocalIndividuals } from '../../services/localDatabase';

type IndividualSearchProps = {
  selectedResidentId: string;
  onChange: (residentId: string) => void;
};

export function IndividualSearch({ selectedResidentId, onChange }: IndividualSearchProps) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Individual[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Directly query SQLite when the search query changes (with a 300ms debounce).
  // The loading flag is raised inside the timeout rather than in the effect body, so
  // typing does not force a synchronous re-render on every keystroke.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setIsLoading(true);
      readLocalIndividuals({ searchQuery: query, limit: 50 })
        .then((results) => {
          setSearchResults(results);
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query]);

  return (
    <>
      <FormField
        label="Search Profile"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name..."
      />
      <SelectField 
        label="Individual" 
        value={selectedResidentId} 
        onChange={(event) => onChange(event.target.value)} 
        required 
        disabled={isLoading || !searchResults.length}
      >
        <option value="" disabled>
          {isLoading ? 'Searching...' : 'Select a resident'}
        </option>
        {searchResults.map((person) => {
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