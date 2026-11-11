import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import { Card, CardBody, DemoTag } from '../components/ui/Card.jsx';
import { ClearFilters, FilterBar, ResultCount, SearchField, SelectFilter } from '../components/ui/Filters.jsx';
import { ActivityIcon, ShieldIcon } from '../components/ui/Icons.jsx';
import PageContainer from '../components/ui/PageContainer.jsx';
import ViewBoundary from '../components/ui/ViewBoundary.jsx';
import { filterAudit, hasActiveFilters } from '../lib/filters.js';
import { EVENT_INFO, eventLabel } from '../lib/reasons.js';
import { formatDateTime } from '../lib/time.js';
import { useDemoStore } from '../state/DemoStore.jsx';
import { useSettings } from '../state/Settings.jsx';

const PAGE_SIZE = 10;
const DEFAULTS = { query: '', event: 'ALL', agentId: 'ALL' };

function initialFilters(search, agentsById) {
  const agent = new URLSearchParams(search).get('agent');
  return { ...DEFAULTS, agentId: agent && agentsById[agent] ? agent : 'ALL' };
}

export default function ActivityPage() {
  const { state, agentsById } = useDemoStore();
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

  const eventOptions = [
    { value: 'ALL', label: 'All events' },
    ...Object.entries(EVENT_INFO).map(([value, label]) => ({ value, label })),
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
            <p className="text-sm text-ink-muted">
              The backend keeps a tamper-evident, append-only audit chain. Verification is not available in this
              demo, so no integrity result and no hashes are shown.
            </p>
          </div>
          <Button disabled title="Chain verification needs the backend" aria-label="Verify chain (not available yet)">
            Verify chain
          </Button>
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
              ) : null}
            </>
          )}
        </ViewBoundary>
      </Card>
    </PageContainer>
  );
}
