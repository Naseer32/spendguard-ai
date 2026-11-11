import { REASON_INFO } from '../lib/reasons.js';

const DOT = {
  success: 'bg-success-600',
  danger: 'bg-danger-600',
  warning: 'bg-warning-600',
};

/** Policy reason codes with a plain-language explanation of each. */
export default function ReasonList({ codes, compact = false }) {
  return (
    <ul className={compact ? 'space-y-1' : 'space-y-2.5'}>
      {codes.map((code) => {
        const info = REASON_INFO[code];
        return (
          <li key={code} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[info?.tone] ?? 'bg-ink-muted'}`}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {info ? info.label : code}{' '}
                <span className="font-mono text-[11px] font-normal text-ink-muted">{code}</span>
              </p>
              {!compact && info ? <p className="text-sm text-ink-muted">{info.text}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
