import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDateTime } from '../lib/time.js';
import { useStore } from '../state/DataStore.jsx';
import { useSettings } from '../state/Settings.jsx';
import Button from './ui/Button.jsx';
import { AccountId, Amount, DetailList } from './ui/Display.jsx';
import { DemoTag } from './ui/Card.jsx';
import Modal from './ui/Modal.jsx';
import StatusBadge from './ui/StatusBadge.jsx';
import ReasonList from './ReasonList.jsx';
import SignPanel from './SignPanel.jsx';

function recipientStanding(recipients, agentId, account) {
  const row = recipients.find((r) => r.agentId === agentId && r.accountId === account);
  if (!row) return 'Not on either list';
  return row.listType === 'ALLOW' ? 'On the allow list' : 'On the block list';
}

/** Read-only detail view of one payment request. `request` is null when closed. */
export default function RequestDetailModal({ request: requestProp, onClose }) {
  const { state, agentsById, isLive, actions } = useStore();
  // Always show the store's copy, so a status the backend just changed is the one the owner sees.
  const request = requestProp === null ? null : (state.requests.find((r) => r.id === requestProp.id) ?? requestProp);
  const { timeZone } = useSettings();
  const navigate = useNavigate();
  const open = request !== null;
  const agent = open ? agentsById[request.agentId] : null;

  const requestId = request?.id;
  const requestAgentId = request?.agentId;
  const { loadPayment, loadRecipients } = actions;
  // Live: open the single payment (adds the approval comment) and the agent's recipient lists.
  useEffect(() => {
    if (!isLive || !requestId) return;
    loadPayment(requestId);
    loadRecipients(requestAgentId);
  }, [isLive, requestId, requestAgentId, loadPayment, loadRecipients]);

  const events = open
    ? state.audit.filter((e) => e.entityId === request.id).sort((a, b) => a.seq - b.seq)
    : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={open ? `Request ${request.id}` : ''}
      description={isLive ? 'Payment request from your SpendGuard backend.' : 'Demo record: sample data, not a real payment.'}
      footer={
        open ? (
          <>
            <Button className="w-full sm:w-auto" onClick={onClose}>Close</Button>
            {request.status === 'APPROVAL_REQUIRED' ? (
              <Button
                variant="primary"
                className="w-full sm:w-auto"
                onClick={() => {
                  onClose();
                  navigate('/approvals');
                }}
              >
                Review in Approvals
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {open ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={request.status} />
            <DemoTag />
          </div>

          <DetailList
            items={[
              { label: 'Amount', value: <Amount yocto={request.amount} className="text-base font-semibold" /> },
              {
                label: 'Agent',
                value: agent ? (
                  <Link to={`/agents/${agent.id}`} onClick={onClose} className="font-medium text-accent-700 hover:underline">
                    {agent.name}
                  </Link>
                ) : (
                  'Unknown agent'
                ),
              },
              { label: 'Recipient', value: <AccountId value={request.recipient} />, wide: true },
              { label: 'Recipient standing', value: recipientStanding(state.recipients, request.agentId, request.recipient) },
              { label: 'Purpose', value: request.purpose ?? '—' },
              { label: 'Created', value: formatDateTime(request.createdAt, timeZone) },
              { label: 'Decided', value: request.decidedAt ? formatDateTime(request.decidedAt, timeZone) : 'Not decided yet' },
              request.decisionComment
                ? { label: 'Owner comment', value: request.decisionComment, wide: true }
                : null,
            ]}
          />

          <section aria-labelledby="req-policy">
            <h3 id="req-policy" className="text-sm font-semibold text-ink">Policy result</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Engine decision: <strong className="font-semibold text-ink">{request.decision}</strong>.
              The decision never changes; the status above tracks where the request is now.
            </p>
            <div className="mt-3">
              <ReasonList codes={request.reasonCodes} />
            </div>
          </section>

          <SignPanel key={request.id} request={request} agent={agent} />

          <section aria-labelledby="req-chain" className="rounded-lg bg-surface px-4 py-3">
            <h3 id="req-chain" className="text-sm font-semibold text-ink">On-chain status</h3>
            <p className="mt-1 text-sm text-ink-muted">
              {request.status === 'EXECUTED' || request.status === 'SUBMITTED'
                ? isLive
                  ? 'No transaction hash is shown here. The backend verifies the transaction on-chain; this app only shows the status the backend reports.'
                  : 'No transaction hash is shown. This demo has no wallet or NEAR connection, so nothing here was sent or verified on-chain.'
                : 'No transaction exists for this request.'}
            </p>
          </section>

          <section aria-labelledby="req-history">
            <h3 id="req-history" className="text-sm font-semibold text-ink">History</h3>
            {events.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">No audit entries for this request.</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {events.map((e) => (
                  <li key={e.seq} className="text-sm">
                    <span className="font-medium text-ink">{e.summary}</span>
                    <span className="block text-xs text-ink-muted">
                      #{e.seq} · {formatDateTime(e.ts, timeZone)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
