import { useEffect, useState } from 'react';
import type { Individual } from '../../types/database';
import { Combobox, type ComboboxOption } from '../common/Combobox';
import { readLocalIndividuals } from '../../services/localDatabase';

type IndividualSearchProps = {
  selectedResidentId: string;
  /** The whole row comes back, not just the id — already read from SQLite, no reason to query again. */
  onChange: (residentId: string, person: Individual | null) => void;
  error?: string;
};

function toOption(person: Individual): ComboboxOption {
  const middleInitial = person.middle_name ? ` ${person.middle_name.charAt(0)}.` : '';

  return {
    value: person.resident_id,
    label: `${person.last_name}, ${person.first_name}${middleInitial}${person.is_household_head ? ' (Head)' : ''}`,
  };
}

export function IndividualSearch({ selectedResidentId, onChange, error }: IndividualSearchProps) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Individual[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<Individual | null>(null);

  // Debounced SQLite query — loading is set inside the timeout, not the effect body, so typing doesn't force a re-render per keystroke.
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

  // The chosen person stays in the list even once the search moves on, or the
  // field would have an id it can't render a name for.
  const options = searchResults.map(toOption);
  if (selected && selected.resident_id === selectedResidentId && !searchResults.some((person) => person.resident_id === selectedResidentId)) {
    options.unshift(toOption(selected));
  }

  return (
    <Combobox
      label="Individual"
      value={selectedResidentId}
      options={options}
      onChange={(residentId) => {
        const person = searchResults.find((entry) => entry.resident_id === residentId) ?? selected;
        setSelected(person);
        onChange(residentId, person?.resident_id === residentId ? person : null);
      }}
      onQueryChange={setQuery}
      placeholder="Search by name..."
      error={error}
      emptyText={isLoading ? 'Searching...' : 'No resident found'}
    />
  );
}
