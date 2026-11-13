import { useMemo, useState } from 'react';
import DecisionModal from '../components/DecisionModal.jsx';
import ReasonList from '../components/ReasonList.jsx';
import Button from '../components/ui/Button.jsx';
import { Card, DemoTag } from '../components/ui/Card.jsx';
import { AccountId, Amount } from '../components/ui/Display.jsx';
import { FilterBar, ResultCount, SelectFilter, Segmented } from '../components/ui/Filters.jsx';
import { ApprovalsIcon, CheckIcon, XIcon } from '../components/ui/Icons.jsx';
import PageContainer from '../components/ui/PageContainer.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import ViewBoundary from '../components/ui/ViewBoundary.jsx';
import { formatDateTime, relativeTime } from '../lib/time.js';
import { useStore } from '../state/DataStore.jsx';
import { useSettings } from '../state/Settings.jsx';

const byOldest = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt);
const byDecided = (a, b) => Date.parse(b.decidedAt ?? b.createdAt) - Date.parse(a.decidedAt ?? a.createdAt);

export default function ApprovalsPage() {
  const { state, agentsById, isLive } = useStore();
  const { timeZone } = useSettings();
  const [tab, setTab] = useState('pending');
  const [agentId, setAgentId] = useState('ALL');
  const [action, setAction] = useState(null); // { request, decision }

  // Pending: waiting for a human. Decided: needed a human at some point.
  const pending = useMemo(
    () => state.requests.filter((r) => r.status === 'APPROVAL_REQUIRED').sort(byOldest),
    [state.requests],
  );
  const decided = useMemo(
    () => state.requests.filter((r) => r.decision === 'APPROVAL_REQUIRED' && r.status !== 'APPROVAL_REQUIRED').sort(byDecided),
    [state.requests],
  );

  const source = tab === 'pending' ? pending : decided;
  const rows = source.filter((r) => agentId === 'ALL' || r.agentId === agentId);
  const agentOptions = [{ value: 'ALL', label: 'All agents' }, ...state.agents.map((a) => ({ value: a.id, label: a.name }))];

  return (
    <PageContainer
      title="Approvals"
      description="Payments that need a human decision before they can proceed."
    >
      <Card aria-labelledby="approvals-title" className="overflow-hidden">
        <h2 id="approvals-title" className="sr-only">Approval queue</h2>
        <FilterBar>
          <Segmented
            label="Approval view"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'pending', label: 'Pending', count: pending.length },
              { id: 'decided', label: 'Decided', count: decided.length },
            ]}
          />
          <SelectFilter label="Filter by agent" value={agentId} onChange={setAgentId} options={agentOptions} />
          <DemoTag className="sm:ml-auto" />
        </FilterBar>

        <ViewBoundary
          total={source.length}
          items={rows}
          loadingLabel="Loading approvals"
          emptyIcon={ApprovalsIcon}
          emptyTitle={tab === 'pending' ? 'No approvals waiting' : 'No decided approvals yet'}
          emptyDescription={tab === 'pending' ? 'You are all caught up. Requests that need a human decision will appear here.' : 'Approved and rejected requests will be listed here.'}
          onClearFilters={() => setAgentId('ALL')}
        >
          {(visible) => (
            <>
              <ResultCount shown={visible.length} total={source.length} noun={tab === 'pending' ? 'pending approvals' : 'decided requests'} />
              <ul className="divide-y divide-line">
                {visible.map((r) => (
                  <li key={r.id} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold text-ink"><Amount yocto={r.amount} /></p>
                        <p className="text-sm text-ink-soft">
                          {agentsById[r.agentId]?.name ?? 'Unknown agent'} to <AccountId value={r.recipient} />
                        </p>
                        {r.purpose ? <p className="mt-0.5 text-sm text-ink-muted">{r.purpose}</p> : null}
                      </div>
                      <div className="flex flex-col items-start gap-1 sm:items-end">
                        <StatusBadge status={r.status} />
                        <span className="text-xs text-ink-muted">
                          {tab === 'pending' ? `Waiting ${relativeTime(r.createdAt).replace(' ago', '')}` : formatDateTime(r.decidedAt, timeZone)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg bg-surface px-3 py-2.5">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{tab === 'pending' ? 'Why it needs approval' : 'Why it needed approval'}</p>
                      <ReasonList codes={r.reasonCodes} compact />
                    </div>

                    {r.decisionComment ? (
                      <p className="mt-3 text-sm text-ink-soft"><span className="font-medium text-ink">Comment:</span> {r.decisionComment}</p>
                    ) : null}

                    {tab === 'pending' ? (
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                        <Button size="lg" variant="danger-outline" onClick={() => setAction({ request: r, decision: 'REJECT' })}>
                          <XIcon className="h-4 w-4" />
                          Reject
                        </Button>
                        <Button size="lg" variant="success" onClick={() => setAction({ request: r, decision: 'APPROVE' })}>
                          <CheckIcon className="h-4 w-4" />
                          Approve
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </ViewBoundary>
      </Card>

      <p className="text-xs text-ink-muted">
        {isLive
          ? 'Decisions are saved to your backend. Approving does not move money: no wallet is involved and nothing is signed or sent from this app.'
          : 'Demo decisions only change sample records in this browser session. No wallet is involved and nothing is signed or sent.'}
      </p>

      <DecisionModal
        request={action?.request ?? null}
        decision={action?.decision ?? null}
        onClose={() => setAction(null)}
      />
    </PageContainer>
  );
}
