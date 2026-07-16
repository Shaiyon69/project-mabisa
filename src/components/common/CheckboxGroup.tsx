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
    <div className="form-field stack" style={{ marginBottom: '1rem' }}>
      <span className="field-label" style={{ fontWeight: 600, fontSize: '0.875rem' }}>{label}</span>
      <div 
        className="checkbox-grid" 
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem', marginTop: '0.25rem' }}
      >
        {options.map((option) => (
          <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
            <input
              type="checkbox"
              checked={selectedValues.includes(option.value)}
              onChange={() => handleToggle(option.value)}
              style={{ cursor: 'pointer' }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}