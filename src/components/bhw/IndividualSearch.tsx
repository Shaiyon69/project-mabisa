import { useEffect, useState } from 'react';
import type { Individual } from '../../types/database';
import { logDev } from '../../lib/utils';
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
  const [readFailed, setReadFailed] = useState(false);
  const [selected, setSelected] = useState<Individual | null>(null);

  // Debounced SQLite query, with loading set inside the timeout so typing does not
  // re-render per keystroke. `current` guards the read as well as the timer:
  // clearing the timeout does nothing to a query already in flight, so a slow
  // result for "cru" could otherwise land after a fast one for "cruz".
  useEffect(() => {
    let current = true;

    const timeoutId = setTimeout(() => {
      setIsLoading(true);
      readLocalIndividuals({ searchQuery: query, limit: 50 })
        .then((results) => {
          if (current) {
            setSearchResults(results);
            setReadFailed(false);
          }
        })
        .catch((cause: unknown) => {
          logDev('Resident search failed', cause instanceof Error ? cause.message : cause);

          if (current) {
            setReadFailed(true);
          }
        })
        .finally(() => {
          if (current) {
            setIsLoading(false);
          }
        });
    }, 300);

    return () => {
      current = false;
      clearTimeout(timeoutId);
    };
  }, [query]);

  // The chosen person stays in the list once the search moves on, or the field
  // holds an id it cannot render a name for.
  const options = searchResults.map(toOption);
  if (selected && selected.resident_id === selectedResidentId && !searchResults.some((person) => person.resident_id === selectedResidentId)) {
    options.unshift(toOption(selected));
  }

  return (
    <Combobox
      label="Individual"
      required
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
      emptyText={isLoading ? 'Searching...' : readFailed ? "Could not read this device's records" : 'No resident found'}
    />
  );
}
