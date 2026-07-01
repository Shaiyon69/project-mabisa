import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function Input({ label, ...props }: InputProps) {
  return (
    <label>
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
