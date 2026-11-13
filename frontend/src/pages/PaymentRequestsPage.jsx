import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import RequestDetailModal from '../components/RequestDetailModal.jsx';
import { Card, DemoTag } from '../components/ui/Card.jsx';
import DataList from '../components/ui/DataList.jsx';
import { AccountId, Amount } from '../components/ui/Display.jsx';
import { ClearFilters, FilterBar, ResultCount, SearchField, SelectFilter } from '../components/ui/Filters.jsx';
import { PaymentsIcon } from '../components/ui/Icons.jsx';
import PageContainer from '../components/ui/PageContainer.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import ViewBoundary from '../components/ui/ViewBoundary.jsx';
import { filterRequests, hasActiveFilters, REQUEST_SORTS } from '../lib/filters.js';
import { reasonLabel } from '../lib/reasons.js';
import { REQUEST_STATUS_OPTIONS, STATUS_META } from '../lib/status.js';
import { relativeTime } from '../lib/time.js';
import { useStore } from '../state/DataStore.jsx';

const DEFAULTS = { query: '', status: 'ALL', agentId: 'ALL', sort: 'newest' };

/** Initial filters may arrive from a link such as /payment-requests?agent=demo-agent-1. */
function initialFilters(search, agentsById) {
  const p = new URLSearchParams(search);
  const status = p.get('status');
  const agent = p.get('agent');
  return {
    ...DEFAULTS,
    status: status && STATUS_META[status] ? status : 'ALL',
    agentId: agent && agentsById[agent] ? agent : 'ALL',
  };
}

export default function PaymentRequestsPage() {
  const { state, agentsById } = useStore();
  const { search } = useLocation();
  const [filters, setFilters] = useState(() => initialFilters(search, agentsById));
  const [selectedId, setSelectedId] = useState(null);

  const rows = useMemo(
    () => filterRequests(state.requests, agentsById, filters),
    [state.requests, agentsById, filters],
  );
  const selected = state.requests.find((r) => r.id === selectedId) ?? null;
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const clear = () => setFilters(DEFAULTS);

  const statusOptions = [
    { value: 'ALL', label: 'All statuses' },
    ...REQUEST_STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_META[s].label })),
  ];
  const agentOptions = [
    { value: 'ALL', label: 'All agents' },
    ...state.agents.map((a) => ({ value: a.id, label: a.name })),
  ];

  const columns = [
    {
      key: 'request',
      header: 'Request',
      render: (r) => (
        <>
          <span className="block font-medium text-ink">{r.purpose ?? r.id}</span>
          <span className="font-mono text-xs text-ink-muted">{r.id}</span>
        </>
      ),
    },
    { key: 'agent', header: 'Agent', render: (r) => agentsById[r.agentId]?.name ?? 'Unknown agent' },
    { key: 'recipient', header: 'Recipient', className: 'whitespace-nowrap', render: (r) => <AccountId value={r.recipient} className="text-ink-soft" /> },
    { key: 'amount', header: 'Amount', align: 'right', className: 'whitespace-nowrap', render: (r) => <Amount yocto={r.amount} className="font-medium" /> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'created', header: 'Created', render: (r) => <span className="text-ink-muted">{relativeTime(r.createdAt)}</span> },
  ];

  return (
    <PageContainer
      title="Payment Requests"
      description="Every payment an agent asked SpendGuard to evaluate, and what happened to it."
    >
      <Card aria-labelledby="requests-title" className="overflow-hidden">
        <h2 id="requests-title" className="sr-only">Payment request list</h2>
        <FilterBar>
          <SearchField value={filters.query} onChange={set('query')} placeholder="Search requests" label="Search payment requests" />
          <SelectFilter label="Filter by status" value={filters.status} onChange={set('status')} options={statusOptions} />
          <SelectFilter label="Filter by agent" value={filters.agentId} onChange={set('agentId')} options={agentOptions} />
          <SelectFilter label="Sort" value={filters.sort} onChange={set('sort')} options={REQUEST_SORTS.map((s) => ({ value: s.id, label: s.label }))} />
          {hasActiveFilters(filters, DEFAULTS) ? <ClearFilters onClick={clear} /> : null}
          <DemoTag className="sm:ml-auto" />
        </FilterBar>

        <ViewBoundary
          total={state.requests.length}
          items={rows}
          loadingLabel="Loading payment requests"
          emptyIcon={PaymentsIcon}
          emptyTitle="No payment requests yet"
          emptyDescription="When an agent submits a payment request, its decision will appear here."
          onClearFilters={clear}
        >
          {(visible) => (
            <>
              <ResultCount shown={visible.length} total={state.requests.length} noun="requests" />
              <DataList
                rows={visible}
                getKey={(r) => r.id}
                columns={columns}
                caption="Payment requests"
                onOpen={(r) => setSelectedId(r.id)}
                renderCard={(r) => (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{r.purpose ?? r.id}</p>
                        <p className="text-sm text-ink-muted">{agentsById[r.agentId]?.name ?? 'Unknown agent'}</p>
                      </div>
                      <p className="shrink-0 font-semibold text-ink"><Amount yocto={r.amount} /></p>
                    </div>
                    <p className="text-xs text-ink-muted">to <AccountId value={r.recipient} className="text-xs" /></p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-ink-muted">
                        {r.reasonCodes[0] ? reasonLabel(r.reasonCodes[0]) : ''} · {relativeTime(r.createdAt)}
                      </span>
                    </div>
                  </div>
                )}
              />
            </>
          )}
        </ViewBoundary>
      </Card>

      <p className="text-xs text-ink-muted">
        Requests are created by agents through the SpendGuard API, so there is no "new request" form here.
      </p>

      <RequestDetailModal request={selected} onClose={() => setSelectedId(null)} />
    </PageContainer>
  );
}
