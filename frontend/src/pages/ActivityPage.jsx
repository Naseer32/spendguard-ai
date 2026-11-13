import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import { Card, CardBody, DemoTag } from '../components/ui/Card.jsx';
import { ClearFilters, FilterBar, ResultCount, SearchField, SelectFilter } from '../components/ui/Filters.jsx';
import { ActivityIcon, ShieldIcon } from '../components/ui/Icons.jsx';
import PageContainer from '../components/ui/PageContainer.jsx';
import ViewBoundary from '../components/ui/ViewBoundary.jsx';
import { filterAudit, hasActiveFilters } from '../lib/filters.js';
import { AUDIT_EVENT_CODES, eventLabel } from '../lib/reasons.js';
import { formatDateTime } from '../lib/time.js';
import { useStore } from '../state/DataStore.jsx';
import { useSettings } from '../state/Settings.jsx';

const PAGE_SIZE = 10;
const DEFAULTS = { query: '', event: 'ALL', agentId: 'ALL' };

function initialFilters(search, agentsById) {
  const agent = new URLSearchParams(search).get('agent');
  return { ...DEFAULTS, agentId: agent && agentsById[agent] ? agent : 'ALL' };
}

export default function ActivityPage() {
  const { state, agentsById, isLive, actions, auditHasOlder } = useStore();
  const [verify, setVerify] = useState({ busy: false, result: null, error: null });
  const [olderBusy, setOlderBusy] = useState(false);
  const { timeZone } = useSettings();
  const { search } = useLocation();
  const [filters, setFilters] = useState(() => initialFilters(search, agentsById));
  const [limit, setLimit] = useState(PAGE_SIZE);

  const rows = useMemo(() => filterAudit(state.audit, filters), [state.audit, filters]);
  const set = (key) => (value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setLimit(PAGE_SIZE);
  };
  const clear = () => {
    setFilters(DEFAULTS);
    setLimit(PAGE_SIZE);
  };

  async function runVerify() {
    setVerify({ busy: true, result: null, error: null });
    const r = await actions.verifyAudit();
    setVerify(r.ok ? { busy: false, result: r.verification, error: null } : { busy: false, result: null, error: r.error });
  }

  async function loadOlder() {
    setOlderBusy(true);
    await actions.loadOlderAudit();
    setOlderBusy(false);
    setLimit((l) => l + PAGE_SIZE * 5);
  }

  const eventOptions = [
    { value: 'ALL', label: 'All events' },
    ...AUDIT_EVENT_CODES.map((value) => ({ value, label: eventLabel(value) })),
  ];
  const agentOptions = [
    { value: 'ALL', label: 'All agents' },
    ...state.agents.map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <PageContainer
      title="Activity & Audit"
      description="A history of decisions and changes, newest first."
    >
      <Card aria-labelledby="chain-title">
        <CardBody className="flex flex-wrap items-center gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
            <ShieldIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="chain-title" className="text-sm font-semibold text-ink">Audit chain integrity</h2>
            {isLive ? (
              <p className="text-sm text-ink-muted" aria-live="polite">
                {verify.error
                  ? verify.error
                  : verify.result
                    ? verify.result.valid
                      ? `Verified: all ${verify.result.entries} entries link correctly.${verify.result.truncated ? ' (The backend checked only part of the chain.)' : ''}`
                      : `Verification FAILED on ${verify.result.entries} entries. ${verify.result.problems.length} problem(s) found.`
                    : 'The backend keeps a tamper-evident, append-only audit chain. Run a check to have it verify every link.'}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">
                The backend keeps a tamper-evident, append-only audit chain. Verification is not available in this
                demo, so no integrity result and no hashes are shown.
              </p>
            )}
            {isLive && verify.result && !verify.result.valid ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-danger-700">
                {verify.result.problems.map((p, i) => (
                  <li key={i}>
                    {p.seq !== null ? `Entry #${p.seq}: ` : ''}
                    {p.code}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {isLive ? (
            <Button onClick={runVerify} disabled={verify.busy}>
              {verify.busy ? 'Verifying…' : 'Verify chain'}
            </Button>
          ) : (
            <Button disabled title="Chain verification needs the backend" aria-label="Verify chain (not available in demo)">
              Verify chain
            </Button>
          )}
        </CardBody>
      </Card>

      <Card aria-labelledby="audit-title" className="overflow-hidden">
        <h2 id="audit-title" className="sr-only">Audit entries</h2>
        <FilterBar>
          <SearchField value={filters.query} onChange={set('query')} placeholder="Search activity" label="Search activity" />
          <SelectFilter label="Filter by event type" value={filters.event} onChange={set('event')} options={eventOptions} />
          <SelectFilter label="Filter by agent" value={filters.agentId} onChange={set('agentId')} options={agentOptions} />
          {hasActiveFilters(filters, DEFAULTS) ? <ClearFilters onClick={clear} /> : null}
          <DemoTag className="sm:ml-auto" />
        </FilterBar>

        <ViewBoundary
          total={state.audit.length}
          items={rows}
          loadingLabel="Loading activity"
          emptyIcon={ActivityIcon}
          emptyTitle="No activity yet"
          emptyDescription="Decisions and changes will be recorded here."
          onClearFilters={clear}
        >
          {(visible) => (
            <>
              <ResultCount shown={Math.min(limit, visible.length)} total={visible.length} noun="entries" />
              <ol className="divide-y divide-line">
                {visible.slice(0, limit).map((e) => (
                  <li key={e.seq} className="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
                    <span className="w-14 shrink-0 font-mono text-xs text-ink-muted sm:pt-0.5">#{e.seq}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{eventLabel(e.event)}</p>
                      <p className="text-sm text-ink-soft">{e.summary}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">By {e.actor}</p>
                    </div>
                    <time dateTime={e.ts} className="shrink-0 text-xs text-ink-muted sm:text-right">
                      {formatDateTime(e.ts, timeZone)}
                    </time>
                  </li>
                ))}
              </ol>
              {visible.length > limit ? (
                <div className="border-t border-line p-4 text-center">
                  <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                    Load more ({visible.length - limit} remaining)
                  </Button>
                </div>
              ) : auditHasOlder ? (
                <div className="border-t border-line p-4 text-center">
                  <Button onClick={loadOlder} disabled={olderBusy}>
                    {olderBusy ? 'Loading…' : 'Load older entries from the backend'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </ViewBoundary>
      </Card>
    </PageContainer>
  );
}
