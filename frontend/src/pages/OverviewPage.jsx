import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardHeader, DemoTag, StatCard } from '../components/ui/Card.jsx';
import DataList from '../components/ui/DataList.jsx';
import DemoBanner from '../components/ui/DemoBanner.jsx';
import { AccountId, Amount, ProgressBar } from '../components/ui/Display.jsx';
import { AgentsIcon, ApprovalsIcon, PaymentsIcon, XIcon } from '../components/ui/Icons.jsx';
import PageContainer from '../components/ui/PageContainer.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import ViewBoundary from '../components/ui/ViewBoundary.jsx';
import { dailyUsed } from '../lib/budget.js';
import { percentOf, sumYocto } from '../lib/money.js';
import { STATUS_META, STATUS_ORDER } from '../lib/status.js';
import { relativeTime, utcDay } from '../lib/time.js';
import { useDemoStore } from '../state/DemoStore.jsx';

function StatusLegend() {
  return (
    <Card aria-labelledby="legend-title">
      <CardHeader id="legend-title" title="Status guide" description="What each status means." />
      <ul className="divide-y divide-line">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="flex flex-col items-start gap-1.5 px-4 py-3 sm:px-5">
            <StatusBadge status={s} />
            <p className="text-sm text-ink-muted">{STATUS_META[s].description}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function OverviewPage() {
  const { state, agentsById } = useDemoStore();
  const navigate = useNavigate();
  const nowIso = useMemo(() => new Date().toISOString(), []);

  const stats = useMemo(() => {
    const active = state.agents.filter((a) => a.status === 'ACTIVE').length;
    const totalBudget = sumYocto(state.agents.filter((a) => a.status === 'ACTIVE').map((a) => a.dailyBudget));
    const spent = sumYocto(state.agents.map((a) => dailyUsed(state.requests, a.id, nowIso)));
    const today = utcDay(nowIso);
    return {
      total: state.agents.length,
      active,
      paused: state.agents.length - active,
      totalBudget,
      spent,
      pending: state.requests.filter((r) => r.status === 'APPROVAL_REQUIRED').length,
      blockedToday: state.requests.filter((r) => r.status === 'BLOCKED' && utcDay(r.createdAt) === today).length,
    };
  }, [state, nowIso]);

  const recent = useMemo(
    () => [...state.requests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5),
    [state.requests],
  );

  const columns = [
    {
      key: 'agent',
      header: 'Agent',
      render: (r) => <span className="font-medium text-ink">{agentsById[r.agentId]?.name ?? 'Unknown agent'}</span>,
    },
    { key: 'recipient', header: 'Recipient', className: 'whitespace-nowrap', render: (r) => <AccountId value={r.recipient} className="text-ink-soft" /> },
    { key: 'amount', header: 'Amount', align: 'right', className: 'whitespace-nowrap', render: (r) => <Amount yocto={r.amount} className="font-medium" /> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'time', header: 'When', render: (r) => <span className="text-ink-muted">{relativeTime(r.createdAt)}</span> },
  ];

  return (
    <PageContainer title="Overview" description="Spending activity and items that need your attention.">
      <DemoBanner />

      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4">
        <StatCard
          label="Total agents"
          value={stats.total}
          hint={`${stats.active} active · ${stats.paused} paused`}
          icon={AgentsIcon}
          demo
        />
        <StatCard
          label="Daily spending"
          value={<Amount yocto={stats.spent} />}
          hint="spent today (UTC)"
          icon={PaymentsIcon}
          demo
        >
          <div className="mt-3">
            <ProgressBar percent={percentOf(stats.spent, stats.totalBudget)} label="Daily budget used across active agents (demo)" />
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            Budget across active agents: <Amount yocto={stats.totalBudget} />
          </p>
        </StatCard>
        <StatCard
          label="Pending approvals"
          value={stats.pending}
          hint={stats.pending === 1 ? 'awaiting a decision' : 'awaiting decisions'}
          icon={ApprovalsIcon}
          demo
        >
          <Link to="/approvals" className="mt-2 inline-block text-sm font-medium text-accent-700 hover:underline">
            Review approvals
          </Link>
        </StatCard>
        <StatCard label="Blocked requests" value={stats.blockedToday} hint="today (UTC)" icon={XIcon} demo>
          <Link to="/payment-requests?status=BLOCKED" className="mt-2 inline-block text-sm font-medium text-accent-700 hover:underline">
            View blocked
          </Link>
        </StatCard>
      </div>

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-3">
        <Card aria-labelledby="recent-activity-title" className="overflow-hidden xl:col-span-2">
          <CardHeader
            id="recent-activity-title"
            title={<span className="flex items-center gap-2">Recent payment activity <DemoTag /></span>}
            description="The latest sample requests and their outcomes."
            action={<Link to="/payment-requests" className="text-sm font-medium text-accent-700 hover:underline">View all</Link>}
          />
          <ViewBoundary
            total={state.requests.length}
            items={recent}
            loadingLabel="Loading recent payment activity"
            errorTitle="Could not load activity"
            errorMessage="Recent payment activity is unavailable right now."
            emptyIcon={PaymentsIcon}
            emptyTitle="No payment activity yet"
            emptyDescription="When an agent submits a payment request, its decision will appear here."
          >
            {(rows) => (
              <DataList
                rows={rows}
                getKey={(r) => r.id}
                columns={columns}
                caption="Recent payment activity"
                onOpen={() => navigate('/payment-requests')}
                renderCard={(r) => (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{agentsById[r.agentId]?.name ?? 'Unknown agent'}</p>
                        <p className="truncate text-sm text-ink-muted">to {r.recipient}</p>
                      </div>
                      <p className="shrink-0 font-semibold text-ink"><Amount yocto={r.amount} /></p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-ink-muted">{relativeTime(r.createdAt)}</span>
                    </div>
                  </div>
                )}
              />
            )}
          </ViewBoundary>
        </Card>
        <StatusLegend />
      </div>

      <p className="text-xs text-ink-muted">
        Nothing on this page is a real payment or transaction. SpendGuard never shows transaction hashes until
        they are verified on-chain.
      </p>
    </PageContainer>
  );
}
