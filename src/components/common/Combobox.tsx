import { useEffect, useRef, useState } from 'react';
import { FieldShell } from './FormField';

export type ComboboxOption = { value: string; label: string };

type ComboboxProps = {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  /** Fired on every keystroke, for callers whose option list comes from a query. */
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  emptyText?: string;
  /** Marks the field, as on the plain inputs — this stands in for a required <select>. */
  required?: boolean;
};

/**
 * Type-ahead select. The value handed back is always an option's id, never the
 * typed text, which is why this is not a native <datalist>.
 */
export function Combobox({
  label,
  value,
  options,
  onChange,
  onQueryChange,
  placeholder,
  hint,
  error,
  disabled,
  emptyText,
  required,
}: ComboboxProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const term = query.trim().toLowerCase();
  // A caller with onQueryChange already filtered `options` server-side (and may
  // match on fields `label` does not carry) — re-filtering here would drop them.
  const matches = !onQueryChange && term ? options.filter((option) => option.label.toLowerCase().includes(term)) : options;
  const selectedLabel = options.find((option) => option.value === value)?.label ?? '';

  // Closes on a tap or Tab anywhere else: pointerdown for another control,
  // focusin for keyboard-only moves that never produce a click.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeIfOutside(event: Event) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('focusin', closeIfOutside);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('focusin', closeIfOutside);
    };
  }, [isOpen]);

  function select(option: ComboboxOption) {
    onChange(option.value);
    setQuery('');
    // The caller's list is filtered by its own copy of the term, so clearing only
    // the local one leaves an empty box over the last search's results.
    onQueryChange?.('');
    setIsOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        return Math.max(0, Math.min(next, matches.length - 1));
      });
      return;
    }

    if (event.key === 'Enter' && isOpen) {
      // Without this the Enter that picks an option also submits the form.
      event.preventDefault();
      const option = matches[activeIndex];
      if (option) {
        select(option);
      }
      return;
    }

    if (event.key === 'Escape') {
      setIsOpen(false);
    }
  }

  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      <div className="combobox" ref={wrapperRef}>
        <input
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-invalid={Boolean(error)}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={isOpen ? query : selectedLabel}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
            onQueryChange?.(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        {isOpen ? (
          <ul className="combobox-list" role="listbox">
            {matches.length ? (
              matches.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={`combobox-option${index === activeIndex ? ' is-active' : ''}`}
                    // FieldShell is a <label>, so without preventDefault the click
                    // refocuses the input and reopens the list.
                    onClick={(event) => {
                      event.preventDefault();
                      select(option);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))
            ) : (
              <li className="combobox-empty">{emptyText ?? 'No matches'}</li>
            )}
          </ul>
        ) : null}
      </div>
    </FieldShell>
  );
}
