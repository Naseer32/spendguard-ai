// Reserved slot for NEAR network status.
// F1: no RPC or backend integration exists, so the status is always "unknown"
// and the UI says so. Later stages can pass a real `status` ("connected" |
// "error") without changing this component's markup.

const STATES = {
  unknown: { dot: 'bg-ink-muted', text: 'Not connected' },
  connected: { dot: 'bg-success-600', text: 'Connected' },
  error: { dot: 'bg-danger-600', text: 'Unavailable' },
};

export default function NetworkStatus({ status = 'unknown' }) {
  const s = STATES[status] ?? STATES.unknown;
  return (
    <div
      className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-xs"
      role="status"
      aria-label={`NEAR Testnet: ${s.text}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
      <span className="font-semibold text-ink">
        NEAR <span className="hidden sm:inline">Testnet</span>
        <span className="sm:hidden">TN</span>
      </span>
      <span className="hidden text-ink-muted md:inline">{s.text}</span>
    </div>
  );
}
