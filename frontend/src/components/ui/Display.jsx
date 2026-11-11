import { formatNear } from '../../lib/money.js';

/** NEAR amount from a yocto string, e.g. "1,250.5 NEAR". */
export function Amount({ yocto, className = '' }) {
  return (
    <span className={`tabular-nums ${className}`}>
      {formatNear(yocto)} <span className="font-normal text-ink-muted">NEAR</span>
    </span>
  );
}

/** NEAR account ID in a monospace face that can wrap on narrow screens. */
export function AccountId({ value, className = '' }) {
  return <span className={`break-all font-mono text-[13px] ${className}`}>{value}</span>;
}

/** Thin progress bar. Colour shifts to amber, then red, as a budget fills up. */
export function ProgressBar({ percent, label }) {
  const tone = percent >= 90 ? 'bg-danger-600' : percent >= 70 ? 'bg-warning-600' : 'bg-accent-600';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 overflow-hidden rounded-full bg-surface-strong"
    >
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Label/value pairs. Stacks on phones, two columns from `sm`. */
export function DetailList({ items }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items
        .filter((i) => i !== null && i !== undefined)
        .map((i) => (
          <div key={i.label} className={`min-w-0 ${i.wide ? 'sm:col-span-2' : ''}`}>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{i.label}</dt>
            <dd className="mt-1 text-sm text-ink">{i.value}</dd>
          </div>
        ))}
    </dl>
  );
}
