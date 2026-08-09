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

  // fieldset/legend rather than a div and a span: it is what tells a screen
  // reader that these options answer one question.
  return (
    <fieldset className="choice-group">
      <legend>{label}</legend>
      <div className="choice-list">
        {options.map((option) => {
          const checked = selectedValues.includes(option.value);

          return (
            // The checked class rather than :has() — the state is already here,
            // and some of the Android builds this ships to predate :has().
            <label key={option.value} className={`choice${checked ? ' is-checked' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => handleToggle(option.value)} />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
