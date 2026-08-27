import { useEffect, useState } from 'react';
import type { Individual } from '../../types/database';
import { Combobox, type ComboboxOption } from '../common/Combobox';
import { readLocalIndividuals } from '../../services/localDatabase';
import { useBhwLanguage } from '../../app/bhwLanguage';

type IndividualSearchProps = {
  selectedResidentId: string;
  /**
   * The whole row comes back, not just the id: this component has already read
   * the person out of SQLite, so a caller that needs their age or flags should
   * not go back to the database for a row that is sitting right here.
   */
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
  const { t } = useBhwLanguage();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Individual[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<Individual | null>(null);

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

  // The chosen person has to stay in the list even once the search moves on,
  // otherwise the field has an id it cannot render a name for. Matching against
  // the prop rather than clearing the cache means the parent resetting the
  // selection (as it does after a save) drops the stale name on its own.
  const options = searchResults.map(toOption);
  if (selected && selected.resident_id === selectedResidentId && !searchResults.some((person) => person.resident_id === selectedResidentId)) {
    options.unshift(toOption(selected));
  }

  return (
    <Combobox
      label={t('Individual')}
      value={selectedResidentId}
      options={options}
      onChange={(residentId) => {
        const person = searchResults.find((entry) => entry.resident_id === residentId) ?? selected;
        setSelected(person);
        onChange(residentId, person?.resident_id === residentId ? person : null);
      }}
      onQueryChange={setQuery}
      placeholder={t('Search by name...')}
      error={error}
      emptyText={t(isLoading ? 'Searching...' : 'No resident found')}
    />
  );
}
