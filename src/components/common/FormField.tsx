import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  /** Marks the field before the BHW submits, rather than only once it has failed. */
  required?: boolean;
  children: ReactNode;
};

export function FieldShell({ label, hint, error, required, children }: FieldShellProps) {
  return (
    <label className={`ui-field${error ? ' has-error' : ''}`}>
      <span>
        {label}
        {required ? (
          <b className="required-mark" aria-hidden="true">
            {' '}
            *
          </b>
        ) : null}
      </span>
      {children}
      {/* The hint stays put under an error. It is the sentence that says how to
          satisfy the field, which is wanted most at the moment the field is wrong. */}
      {error ? <small className="field-error">{error}</small> : null}
      {hint ? <small>{hint}</small> : null}
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
    <FieldShell label={label} hint={hint} error={error} required={props.required}>
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
    <FieldShell label={label} hint={hint} error={error} required={props.required}>
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
    <FieldShell label={label} hint={hint} error={error} required={props.required}>
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
