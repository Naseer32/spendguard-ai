import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ApiKeyDialog from '../components/ApiKeyDialog.jsx';
import { EditLimitsModal } from '../components/AgentForms.jsx';
import RecipientModal from '../components/RecipientModal.jsx';
import RequestDetailModal from '../components/RequestDetailModal.jsx';
import RequestPaymentModal from '../components/RequestPaymentModal.jsx';
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
import { useStore } from '../state/DataStore.jsx';
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
  const { state, agentsById, actions, isLive } = useStore();
  const { timeZone } = useSettings();
  const notify = useToast();
  const nowIso = useMemo(() => new Date().toISOString(), []);

  const [editing, setEditing] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [requestingPayment, setRequestingPayment] = useState(false);
  const [openRequestId, setOpenRequestId] = useState(null);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);

  const [confirmRotate, setConfirmRotate] = useState(false);
  const [issuedKey, setIssuedKey] = useState(null); // { apiKey }: shown once, then dropped
  const [recipientsError, setRecipientsError] = useState(null);

  const agent = agentsById[agentId];
  const loadRecipients = actions.loadRecipients;

  // Live: recipient lists are fetched per agent when its page opens.
  useEffect(() => {
    if (!isLive || !agentId) return undefined;
    let cancelled = false;
    setRecipientsError(null);
    loadRecipients(agentId).then((r) => {
      if (!cancelled && !r.ok) setRecipientsError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [isLive, agentId, loadRecipients]);

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

  const tag = isLive ? '' : ' (demo)';

  async function changeStatus() {
    const r = await actions.setAgentStatus(agent.id, pausing ? 'PAUSED' : 'ACTIVE');
    if (r.ok) {
      notify(pausing ? `${agent.name} paused${tag}. Its payments are now blocked.` : `${agent.name} resumed${tag}.`);
    } else {
      notify(r.error, 'error');
    }
    setConfirmStatus(false);
  }

  async function removeRecipient() {
    if (removeTarget) {
      const r = await actions.removeRecipient(agent.id, removeTarget.accountId);
      if (r.ok) notify(`${removeTarget.accountId} removed${tag}.`);
      else notify(r.error, 'error');
    }
    setRemoveTarget(null);
  }

  async function rotateKey() {
    const r = await actions.rotateKey(agent.id);
    setConfirmRotate(false);
    if (r.ok) setIssuedKey({ apiKey: r.apiKey });
    else notify(r.error, 'error');
  }

  return (
    <PageContainer
      title={agent.name}
      description={undefined}
      actions={
        <div className="flex flex-wrap gap-2">
          {isLive ? <Button variant="primary" onClick={() => setRequestingPayment(true)}>Request a payment</Button> : null}
          <Button onClick={() => setEditing(true)}>Edit limits</Button>
          {isLive ? <Button onClick={() => setConfirmRotate(true)}>Rotate API key</Button> : null}
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
              {isLive
                ? 'The API key is shown once when it is created or rotated. It cannot be viewed again, and this app never stores it.'
                : 'API keys are managed by the backend and are never shown or stored in this app.'}
            </p>
            {isLive ? (
              <p className="text-xs text-ink-muted">
                Spent today is estimated from the most recent payment requests loaded here. The backend does
                not expose a budget-usage figure yet.
              </p>
            ) : null}
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
        {recipientsError ? (
          <p role="alert" className="px-4 py-3 text-sm text-danger-700 sm:px-5">{recipientsError}</p>
        ) : null}
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
                    onClick={async () => {
                      const next = r.listType === 'ALLOW' ? 'BLOCK' : 'ALLOW';
                      const res = await actions.setRecipient(agent.id, { accountId: r.accountId, listType: next, note: r.note });
                      if (res.ok) notify(`${r.accountId} moved to the ${next === 'ALLOW' ? 'allow' : 'block'} list${tag}.`);
                      else notify(res.error, 'error');
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
          <EmptyState
            title="No payment requests yet"
            description={isLive
              ? 'Requests appear here once this agent asks SpendGuard to evaluate a payment. Use "Request a payment" above to send one as this agent, then approve and pay it from your wallet.'
              : 'Requests appear here once this agent asks SpendGuard to evaluate a payment.'}
          />
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
      <RequestPaymentModal
        agent={agent}
        open={requestingPayment}
        onClose={() => setRequestingPayment(false)}
        onCreated={(id) => { setRequestingPayment(false); setOpenRequestId(id); }}
      />
      {openRequestId ? (
        <RequestDetailModal
          request={state.requests.find((r) => r.id === openRequestId) ?? null}
          onClose={() => setOpenRequestId(null)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmStatus}
        onClose={() => setConfirmStatus(false)}
        onConfirm={changeStatus}
        danger={pausing}
        title={pausing ? `Pause ${agent.name}?` : `Resume ${agent.name}?`}
        description={isLive ? 'This is saved to your SpendGuard backend.' : 'Demo only: this changes a sample record in your browser session.'}
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
        description={isLive ? 'This is saved to your SpendGuard backend.' : 'Demo only.'}
        confirmLabel="Remove"
      >
        <p className="text-sm text-ink-muted">
          {removeTarget ? <AccountId value={removeTarget.accountId} /> : null} will no longer be on either list.
          Future payments to it will need your approval.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={rotateKey}
        danger
        title={`Rotate the API key for ${agent.name}?`}
        description="The current key stops working immediately."
        confirmLabel="Rotate key"
      >
        <p className="text-sm text-ink-muted">
          A new key is generated and shown once. Update your agent with it right away, or its payment requests will be refused.
        </p>
      </ConfirmDialog>

      {issuedKey ? (
        <ApiKeyDialog
          apiKey={issuedKey.apiKey}
          agentName={agent.name}
          rotated
          onDone={() => setIssuedKey(null)}
        />
      ) : null}
    </PageContainer>
  );
}
