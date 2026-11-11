// Date/time display helpers. All stored timestamps are ISO-8601 UTC strings.

function parse(iso) {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/** "10 Nov 2026, 14:05" in the viewer's zone, or in UTC (suffixed) when mode is "utc". */
export function formatDateTime(iso, mode = 'local') {
  const ms = parse(iso);
  if (ms === null) return '—';
  const utc = mode === 'utc';
  const text = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: utc ? 'UTC' : undefined,
  }).format(ms);
  return utc ? `${text} UTC` : text;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function relativeTime(iso, nowMs = Date.now()) {
  const ms = parse(iso);
  if (ms === null) return '—';
  const diff = Math.max(0, nowMs - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** UTC budget day "YYYY-MM-DD" for an ISO timestamp, or null. */
export function utcDay(iso) {
  const ms = parse(iso);
  return ms === null ? null : new Date(ms).toISOString().slice(0, 10);
}
