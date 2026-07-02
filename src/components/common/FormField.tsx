import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type FieldShellProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

function FieldShell({ label, hint, children }: FieldShellProps) {
  return (
    <label className="ui-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function FormField({ label, hint, ...props }: FormFieldProps) {
  return (
    <FieldShell label={label} hint={hint}>
      <input {...props} />
    </FieldShell>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  children: ReactNode;
};

export function SelectField({ label, hint, children, ...props }: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint}>
      <select {...props}>{children}</select>
    </FieldShell>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
};

export function TextAreaField({ label, hint, ...props }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint}>
      <textarea {...props} />
    </FieldShell>
  );
}

type FormActionsProps = {
  children: ReactNode;
};

export function FormActions({ children }: FormActionsProps) {
  return <div className="sticky-actions">{children}</div>;
}
