import type { SelectHTMLAttributes } from 'react';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
};

export function Select({ label, children, ...props }: SelectProps) {
  return (
    <label>
      <span>{label}</span>
      <select {...props}>{children}</select>
    </label>
  );
}
