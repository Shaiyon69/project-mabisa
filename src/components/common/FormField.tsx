import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

export function FieldShell({ label, hint, error, children }: FieldShellProps) {
  return (
    <label className={`ui-field${error ? ' has-error' : ''}`}>
      <span>{label}{error ? <b className="required-mark"> *</b> : null}</span>
      {children}
      {error ? <small className="field-error">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function FormField({ label, hint, error, ...props }: FormFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <input aria-invalid={Boolean(error)} {...props} />
    </FieldShell>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

export function SelectField({ label, hint, error, children, ...props }: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <select aria-invalid={Boolean(error)} {...props}>{children}</select>
    </FieldShell>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextAreaField({ label, hint, error, ...props }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <textarea aria-invalid={Boolean(error)} {...props} />
    </FieldShell>
  );
}

type FormActionsProps = {
  children: ReactNode;
};

export function FormActions({ children }: FormActionsProps) {
  return <div className="sticky-actions">{children}</div>;
}
