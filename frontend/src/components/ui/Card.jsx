import { useStore } from '../../state/DataStore.jsx';
export function Card({ as: Tag = 'section', className = '', children, ...rest }) {
  return (
    <Tag
      className={`rounded-xl border border-line bg-white shadow-card ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, action, id }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className = '', children }) {
  return <div className={`px-4 py-4 sm:px-5 ${className}`}>{children}</div>;
}

/** Small "Demo" pill for anything that is sample data, not real data. */
export function DemoTag({ className = '' }) {
  const { isLive } = useStore();
  if (isLive) return null; // live data is never tagged as a demo
  return (
    <span
      className={`inline-flex items-center rounded-md bg-warning-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-700 ring-1 ring-inset ring-warning-200 ${className}`}
    >
      Demo
    </span>
  );
}

/** Metric card. `demo` marks the value as sample data. */
export function StatCard({ label, value, hint, icon: Ic, demo = false, children }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-soft">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
          {Ic ? <Ic className="h-5 w-5" /> : null}
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {demo ? <DemoTag /> : null}
        {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
      </div>
      {children}
    </Card>
  );
}
