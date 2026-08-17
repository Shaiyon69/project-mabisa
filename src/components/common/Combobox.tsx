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
};

/**
 * Type-ahead select: the visible control is a text input, the choices drop
 * below it, and the value handed back is always an option's id — never the
 * text that was typed. A native <datalist> would be less code but matches on
 * the label only, so it cannot carry the id, and Android WebView renders it
 * inconsistently.
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
}: ComboboxProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const term = query.trim().toLowerCase();
  const matches = term ? options.filter((option) => option.label.toLowerCase().includes(term)) : options;
  const selectedLabel = options.find((option) => option.value === value)?.label ?? '';

  // A tap or a Tab anywhere else closes the list, so it never sits over the
  // fields below it. Pointer events fire before focus moves, which covers
  // tapping straight into another control; focusin covers keyboard-only moves
  // and the scroll/zoom gestures that never produce a click.
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
    <FieldShell label={label} hint={hint} error={error}>
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
                    // FieldShell is a <label>: without preventDefault the click is
                    // forwarded to the input, which refocuses and reopens the list.
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
