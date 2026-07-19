type CheckboxOption = {
  label: string;
  value: string;
};

type CheckboxGroupProps = {
  label: string;
  options: CheckboxOption[];
  selectedValues: string[];
  onChange: (newValues: string[]) => void;
};

export function CheckboxGroup({ label, options, selectedValues, onChange }: CheckboxGroupProps) {
  function handleToggle(value: string) {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  }

  return (
    <fieldset className="checkbox-group">
      <legend className="field-label">{label}</legend>
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
    </fieldset>
  );
}
