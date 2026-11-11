import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NewAgentModal } from '../components/AgentForms.jsx';
import { Card, DemoTag } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import DataList from '../components/ui/DataList.jsx';
import { AccountId, Amount, ProgressBar } from '../components/ui/Display.jsx';
import { ClearFilters, FilterBar, ResultCount, SearchField, SelectFilter } from '../components/ui/Filters.jsx';
import { AgentsIcon, PlusIcon } from '../components/ui/Icons.jsx';
import PageContainer from '../components/ui/PageContainer.jsx';
import { AgentStatusBadge } from '../components/ui/StatusBadge.jsx';
import ViewBoundary from '../components/ui/ViewBoundary.jsx';
import { dailyUsed, dailyUsedPercent } from '../lib/budget.js';
import { filterAgents, hasActiveFilters } from '../lib/filters.js';
import { useDemoStore } from '../state/DemoStore.jsx';

const DEFAULTS = { query: '', status: 'ALL' };
const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
];

export default function AgentsPage() {
  const { state } = useDemoStore();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const nowIso = useMemo(() => new Date().toISOString(), []);

  const rows = useMemo(() => filterAgents(state.agents, filters), [state.agents, filters]);
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const open = (agent) => navigate(`/agents/${agent.id}`);

  const columns = [
    {
      key: 'name',
      header: 'Agent',
      render: (a) => (
        <>
          <span className="block font-medium text-ink">{a.name}</span>
          <AccountId value={a.sourceAccount} className="text-ink-muted" />
        </>
      ),
    },
    { key: 'status', header: 'Status', render: (a) => <AgentStatusBadge status={a.status} /> },
    {
      key: 'budget',
      header: 'Spent today',
      className: 'w-56',
      render: (a) => (
        <div className="space-y-1.5">
          <p className="text-xs text-ink-soft">
            <Amount yocto={dailyUsed(state.requests, a.id, nowIso)} /> of <Amount yocto={a.dailyBudget} />
          </p>
          <ProgressBar percent={dailyUsedPercent(state.requests, a, nowIso)} label={`Daily budget used by ${a.name}`} />
        </div>
      ),
    },
    {
      key: 'limits',
      header: 'Per-tx limit',
      align: 'right',
      className: 'whitespace-nowrap',
      render: (a) => <Amount yocto={a.perTxLimit} />,
    },
    {
      key: 'threshold',
      header: 'Approval above',
      align: 'right',
      className: 'whitespace-nowrap',
      render: (a) => <Amount yocto={a.approvalThreshold} />,
    },
  ];

  return (
    <PageContainer
      title="Agents"
      description="Autonomous agents, their spending limits and recipient lists."
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          <PlusIcon className="h-4 w-4" />
          New agent
        </Button>
      }
    >
      <Card aria-labelledby="agents-title" className="overflow-hidden">
        <h2 id="agents-title" className="sr-only">Agent list</h2>
        <FilterBar>
          <SearchField value={filters.query} onChange={set('query')} placeholder="Search agents" label="Search agents" />
          <SelectFilter label="Filter by status" value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
          {hasActiveFilters(filters, DEFAULTS) ? <ClearFilters onClick={() => setFilters(DEFAULTS)} /> : null}
          <DemoTag className="sm:ml-auto" />
        </FilterBar>

        <ViewBoundary
          total={state.agents.length}
          items={rows}
          loadingLabel="Loading agents"
          emptyIcon={AgentsIcon}
          emptyTitle="No agents yet"
          emptyDescription="Create an agent to set spending limits for it."
          emptyAction={<Button variant="primary" onClick={() => setCreating(true)}>New agent</Button>}
          onClearFilters={() => setFilters(DEFAULTS)}
        >
          {(visible) => (
            <>
              <ResultCount shown={visible.length} total={state.agents.length} noun="agents" />
              <DataList
                rows={visible}
                getKey={(a) => a.id}
                columns={columns}
                onOpen={open}
                caption="Agents"
                renderCard={(a) => (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{a.name}</p>
                        <AccountId value={a.sourceAccount} className="text-ink-muted" />
                      </div>
                      <AgentStatusBadge status={a.status} />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs text-ink-soft">
                        Spent today: <Amount yocto={dailyUsed(state.requests, a.id, nowIso)} /> of <Amount yocto={a.dailyBudget} />
                      </p>
                      <ProgressBar percent={dailyUsedPercent(state.requests, a, nowIso)} label={`Daily budget used by ${a.name}`} />
                    </div>
                    <p className="text-xs text-ink-muted">
                      Per-tx limit <Amount yocto={a.perTxLimit} /> · approval above <Amount yocto={a.approvalThreshold} />
                    </p>
                  </div>
                )}
              />
            </>
          )}
        </ViewBoundary>
      </Card>

      <NewAgentModal open={creating} onClose={() => setCreating(false)} />
    </PageContainer>
  );
}
