import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditLimitsModal } from '../components/AgentForms.jsx';
import RecipientModal from '../components/RecipientModal.jsx';
import Button from '../components/ui/Button.jsx';
import { Card, CardBody, CardHeader, DemoTag } from '../components/ui/Card.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { AccountId, Amount, DetailList, ProgressBar } from '../components/ui/Display.jsx';
import {
  AgentsIcon,
  ChevronLeftIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from '../components/ui/Icons.jsx';
import PageContainer from '../components/ui/PageContainer.jsx';
import { EmptyState } from '../components/ui/StateViews.jsx';
import StatusBadge, { AgentStatusBadge } from '../components/ui/StatusBadge.jsx';
import { dailyUsed, dailyUsedPercent } from '../lib/budget.js';
import { compareYocto } from '../lib/money.js';
import { formatDateTime, relativeTime } from '../lib/time.js';
import { useDemoStore } from '../state/DemoStore.jsx';
import { useSettings } from '../state/Settings.jsx';
import { useToast } from '../state/Toasts.jsx';

function ListBadge({ type }) {
  const allow = type === 'ALLOW';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold leading-none ring-1 ring-inset ${
        allow ? 'bg-success-50 text-success-700 ring-success-200' : 'bg-danger-50 text-danger-700 ring-danger-200'
      }`}
    >
      {allow ? 'Allowed' : 'Blocked'}
    </span>
  );
}

export default function AgentDetailPage() {
  const { agentId } = useParams();
  const { state, agentsById, actions } = useDemoStore();
  const { timeZone } = useSettings();
  const notify = useToast();
  const nowIso = useMemo(() => new Date().toISOString(), []);

  const [editing, setEditing] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);

  const agent = agentsById[agentId];

  if (!agent) {
    return (
      <PageContainer title="Agent not found">
        <Card>
          <EmptyState
            icon={AgentsIcon}
            title="This agent does not exist"
            description="It may have been removed, or the link is wrong."
            action={<Link to="/agents" className="font-medium text-accent-700 hover:underline">Back to agents</Link>}
          />
        </Card>
      </PageContainer>
    );
  }

  const recipients = state.recipients.filter((r) => r.agentId === agent.id);
  const requests = state.requests
    .filter((r) => r.agentId === agent.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const events = state.audit.filter((e) => e.agentId === agent.id).sort((a, b) => b.seq - a.seq).slice(0, 5);
  const used = dailyUsed(state.requests, agent.id, nowIso);
  const percent = dailyUsedPercent(state.requests, agent, nowIso);
  const remaining = compareYocto(agent.dailyBudget, used) > 0 ? (BigInt(agent.dailyBudget) - BigInt(used)).toString() : '0';
  const pausing = agent.status === 'ACTIVE';

  function changeStatus() {
    if (actions.setAgentStatus(agent.id, pausing ? 'PAUSED' : 'ACTIVE')) {
      notify(pausing ? `${agent.name} paused (demo). Its payments would now be blocked.` : `${agent.name} resumed (demo).`);
    }
    setConfirmStatus(false);
  }

  function removeRecipient() {
    if (removeTarget && actions.removeRecipient(agent.id, removeTarget.accountId)) {
      notify(`${removeTarget.accountId} removed (demo).`);
    }
    setRemoveTarget(null);
  }

  return (
    <PageContainer
      title={agent.name}
      description={undefined}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing(true)}>Edit limits</Button>
          <Button variant={pausing ? 'danger-outline' : 'primary'} onClick={() => setConfirmStatus(true)}>
            {pausing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
            {pausing ? 'Pause agent' : 'Resume agent'}
          </Button>
        </div>
      }
    >
      <Link to="/agents" className="-mt-2 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-accent-700 hover:underline">
        <ChevronLeftIcon className="h-4 w-4" />
        All agents
      </Link>

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-3">
        <Card aria-labelledby="agent-overview" className="xl:col-span-2">
          <CardHeader id="agent-overview" title={<span className="flex items-center gap-2">Overview <DemoTag /></span>} action={<AgentStatusBadge status={agent.status} />} />
          <CardBody className="space-y-6">
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <p className="font-medium text-ink">Daily budget</p>
                <p className="text-ink-soft"><Amount yocto={used} /> of <Amount yocto={agent.dailyBudget} /></p>
              </div>
              <div className="mt-2"><ProgressBar percent={percent} label="Daily budget used" /></div>
              <p className="mt-1.5 text-xs text-ink-muted"><Amount yocto={remaining} /> left today (UTC day)</p>
            </div>
            <DetailList
              items={[
                { label: 'Per-transaction limit', value: <Amount yocto={agent.perTxLimit} /> },
                { label: 'Approval threshold', value: <Amount yocto={agent.approvalThreshold} /> },
                { label: 'Source account', value: <AccountId value={agent.sourceAccount} />, wide: true },
                { label: 'Created', value: formatDateTime(agent.createdAt, timeZone) },
                { label: 'Last changed', value: formatDateTime(agent.updatedAt, timeZone) },
              ]}
            />
            <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
              API keys are managed by the backend and are never shown or stored in this app.
            </p>
          </CardBody>
        </Card>

        <Card aria-labelledby="agent-activity">
          <CardHeader id="agent-activity" title="Recent audit entries" action={<Link to={`/activity?agent=${agent.id}`} className="text-sm font-medium text-accent-700 hover:underline">View all</Link>} />
          {events.length === 0 ? (
            <EmptyState title="No entries" />
          ) : (
            <ul className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.seq} className="px-4 py-3 sm:px-5">
                  <p className="text-sm text-ink">{e.summary}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">#{e.seq} · {relativeTime(e.ts)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card aria-labelledby="agent-recipients" className="overflow-hidden">
        <CardHeader
          id="agent-recipients"
          title="Recipients"
          description="Allowed recipients can be paid within limits. Blocked recipients are always refused. Unknown recipients need your approval."
          action={
            <Button size="sm" variant="primary" onClick={() => setAddingRecipient(true)}>
              <PlusIcon className="h-4 w-4" />
              Add recipient
            </Button>
          }
        />
        {recipients.length === 0 ? (
          <EmptyState title="No recipients yet" description="Payments to any recipient will need your approval until you allow it." />
        ) : (
          <ul className="divide-y divide-line">
            {recipients.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <AccountId value={r.accountId} className="text-ink" />
                  {r.note ? <p className="text-xs text-ink-muted">{r.note}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <ListBadge type={r.listType} />
                  <Button
                    size="sm"
                    onClick={() => {
                      const next = r.listType === 'ALLOW' ? 'BLOCK' : 'ALLOW';
                      if (actions.setRecipient(agent.id, { accountId: r.accountId, listType: next, note: r.note })) {
                        notify(`${r.accountId} moved to the ${next === 'ALLOW' ? 'allow' : 'block'} list (demo).`);
                      }
                    }}
                  >
                    {r.listType === 'ALLOW' ? 'Block' : 'Allow'}
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${r.accountId}`} onClick={() => setRemoveTarget(r)}>
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="agent-requests" className="overflow-hidden">
        <CardHeader id="agent-requests" title="Payment requests" action={<Link to={`/payment-requests?agent=${agent.id}`} className="text-sm font-medium text-accent-700 hover:underline">View all</Link>} />
        {requests.length === 0 ? (
          <EmptyState title="No payment requests yet" description="Requests appear here once this agent asks SpendGuard to evaluate a payment." />
        ) : (
          <ul className="divide-y divide-line">
            {requests.slice(0, 5).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink"><Amount yocto={r.amount} /></p>
                  <p className="text-xs text-ink-muted">{relativeTime(r.createdAt)} · <AccountId value={r.recipient} className="text-xs" /></p>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EditLimitsModal agent={agent} open={editing} onClose={() => setEditing(false)} />
      <RecipientModal agent={agent} open={addingRecipient} onClose={() => setAddingRecipient(false)} />

      <ConfirmDialog
        open={confirmStatus}
        onClose={() => setConfirmStatus(false)}
        onConfirm={changeStatus}
        danger={pausing}
        title={pausing ? `Pause ${agent.name}?` : `Resume ${agent.name}?`}
        description="Demo only: this changes a sample record in your browser session."
        confirmLabel={pausing ? 'Pause agent' : 'Resume agent'}
      >
        <p className="text-sm text-ink-muted">
          {pausing
            ? 'While paused, every payment request from this agent is blocked.'
            : 'The agent can send payment requests again, within its limits.'}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={removeRecipient}
        danger
        title="Remove recipient?"
        description="Demo only."
        confirmLabel="Remove"
      >
        <p className="text-sm text-ink-muted">
          {removeTarget ? <AccountId value={removeTarget.accountId} /> : null} will no longer be on either list.
          Future payments to it will need your approval.
        </p>
      </ConfirmDialog>
    </PageContainer>
  );
}
