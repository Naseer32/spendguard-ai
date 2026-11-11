import Button from './Button.jsx';
import { AlertIcon, InboxIcon, RefreshIcon } from './Icons.jsx';

export function Skeleton({ className = '' }) {
  return (
    <div className={`animate-pulse rounded-md bg-surface-strong ${className}`} />
  );
}

/** Loading placeholder shaped like a list of rows. Works at any width. */
export function LoadingState({ label = 'Loading', rows = 4 }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-6 w-24 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

function Centered({ icon: Ic, tone, title, children }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center sm:py-12">
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full ${tone}`}
      >
        <Ic className="h-6 w-6" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

export function EmptyState({ title, description, action, icon = InboxIcon }) {
  return (
    <Centered icon={icon} tone="bg-surface text-ink-muted" title={title}>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Centered>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'The data could not be loaded.',
  onRetry,
}) {
  return (
    <div role="alert">
      <Centered icon={AlertIcon} tone="bg-danger-50 text-danger-600" title={title}>
        <p className="mt-1 max-w-sm text-sm text-ink-muted">{message}</p>
        {onRetry ? (
          <Button className="mt-4" onClick={onRetry}>
            <RefreshIcon className="h-4 w-4" />
            Try again
          </Button>
        ) : null}
      </Centered>
    </div>
  );
}
