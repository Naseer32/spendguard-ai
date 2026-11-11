import Button from './Button.jsx';
import { SearchIcon, XIcon } from './Icons.jsx';

/** Row/column wrapper for filter controls. Stacks on phones. */
export function FilterBar({ children }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
      {children}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = 'Search', label = 'Search' }) {
  return (
    <div className="relative min-w-0 sm:w-72">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="block min-h-11 w-full rounded-lg border border-line bg-white pl-9 pr-9 text-base text-ink placeholder:text-ink-muted/70 sm:min-h-10 sm:text-sm"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted hover:text-ink"
        >
          <XIcon className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Compact labelled <select> for filters. `options` is [{value, label}]. */
export function SelectFilter({ label, value, onChange, options }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base text-ink sm:min-h-10 sm:w-auto sm:text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ClearFilters({ onClick }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      <XIcon className="h-4 w-4" />
      Clear filters
    </Button>
  );
}

/** Segmented control (single choice). Uses aria-pressed buttons. */
export function Segmented({ label, value, onChange, items }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-surface p-0.5">
      {items.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={value === s.id}
          onClick={() => onChange(s.id)}
          className={`min-h-10 rounded-md px-3.5 text-sm font-medium transition-colors ${
            value === s.id ? 'bg-white text-ink shadow-card' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {s.label}
          {s.count !== undefined ? (
            <span className="ml-1.5 rounded-full bg-surface-strong px-1.5 py-0.5 text-xs text-ink-soft">
              {s.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** "Showing X of Y" line under the filters. */
export function ResultCount({ shown, total, noun }) {
  return (
    <p className="px-4 py-2 text-xs text-ink-muted sm:px-5" aria-live="polite">
      Showing {shown} of {total} {noun}
    </p>
  );
}
