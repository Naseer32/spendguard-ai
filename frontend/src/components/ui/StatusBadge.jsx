import { STATUS_META } from '../../lib/status.js';
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  DoubleCheckIcon,
  PauseIcon,
  XIcon,
} from './Icons.jsx';

const TONE_CLASSES = {
  success: 'bg-success-50 text-success-700 ring-success-200',
  danger: 'bg-danger-50 text-danger-700 ring-danger-200',
  warning: 'bg-warning-50 text-warning-700 ring-warning-200',
  neutral: 'bg-surface text-ink-soft ring-line',
  accent: 'bg-accent-50 text-accent-700 ring-accent-100',
};

const STATUS_ICONS = {
  APPROVED: CheckIcon,
  BLOCKED: XIcon,
  APPROVAL_REQUIRED: AlertIcon,
  PENDING: ClockIcon,
  EXECUTED: DoubleCheckIcon,
  REJECTED: XIcon,
  EXPIRED: ClockIcon,
  CANCELLED: XIcon,
  SUBMITTED: ClockIcon,
  FAILED: AlertIcon,
  MISMATCH: AlertIcon,
};

/**
 * Status badge. Colour is never the only signal: each status also has an icon
 * and a text label. Unknown statuses render neutrally with their raw value so
 * a new backend status is visible rather than silently mislabelled.
 */
export default function StatusBadge({ status, className = '' }) {
  const meta = STATUS_META[status];
  const Ic = STATUS_ICONS[status];
  const tone = meta ? TONE_CLASSES[meta.tone] : TONE_CLASSES.neutral;

  return (
    <span
      title={meta ? `${status}: ${meta.description}` : String(status)}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold leading-none ring-1 ring-inset ${tone} ${className}`}
    >
      {Ic ? <Ic className="h-3.5 w-3.5" /> : null}
      {meta ? meta.label : String(status ?? 'Unknown')}
    </span>
  );
}

const AGENT_STATUS_META = {
  ACTIVE: { label: 'Active', tone: TONE_CLASSES.success, icon: CheckIcon },
  PAUSED: { label: 'Paused', tone: TONE_CLASSES.warning, icon: PauseIcon },
};

/** Agent status (ACTIVE / PAUSED), styled like the payment status badges. */
export function AgentStatusBadge({ status, className = '' }) {
  const meta = AGENT_STATUS_META[status];
  const Ic = meta?.icon;
  return (
    <span
      title={String(status)}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold leading-none ring-1 ring-inset ${meta ? meta.tone : TONE_CLASSES.neutral} ${className}`}
    >
      {Ic ? <Ic className="h-3.5 w-3.5" /> : null}
      {meta ? meta.label : String(status ?? 'Unknown')}
    </span>
  );
}
