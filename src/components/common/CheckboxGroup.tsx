type CheckboxOption = {
  label: string;
  value: string;
};

type CheckboxGroupProps = {
  label: string;
  options: CheckboxOption[];
  selectedValues: string[];
  onChange: (newValues: string[]) => void;
  error?: string;
};

export function CheckboxGroup({ label, options, selectedValues, onChange, error }: CheckboxGroupProps) {
  function handleToggle(value: string) {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  }

  return (
    <fieldset className={`checkbox-group${error ? ' has-error' : ''}`} aria-invalid={Boolean(error)}>
      <legend className="field-label">{label}{error ? <b className="required-mark"> *</b> : null}</legend>
      <div className="checkbox-grid">
        {options.map((option) => {
          const isSelected = selectedValues.includes(option.value);

          return (
            <label key={option.value} className={`check-option${isSelected ? ' is-selected' : ''}`}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleToggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      {error ? <small className="field-error">{error}</small> : null}
    </fieldset>
  );
}
