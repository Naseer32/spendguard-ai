import { useId } from 'react';

// Form controls with a visible label, hint and error. 16px text on inputs
// prevents iOS/Android browsers from zooming the page on focus.

const CONTROL =
  'block w-full rounded-lg border bg-white px-3 text-base text-ink placeholder:text-ink-muted/70 sm:text-sm';

function controlClass(error) {
  return `${CONTROL} ${error ? 'border-danger-600' : 'border-line'}`;
}

function FieldShell({ id, label, hint, error, optional, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {optional ? <span className="ml-1 font-normal text-ink-muted">(optional)</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id, hint, error) {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

export function TextField({ label, hint, error, optional, className = '', ...rest }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${controlClass(error)} min-h-11 ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({ label, hint, error, children, ...rest }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${controlClass(error)} min-h-11`}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, error, optional, rows = 3, ...rest }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${controlClass(error)} py-2`}
        {...rest}
      />
    </FieldShell>
  );
}
