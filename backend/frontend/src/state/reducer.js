// Pure state transitions for the DEMO store. No React, no I/O, no clock:
// callers pass `now` (ISO string) and any new ids, so this is deterministic
// and unit-testable.
//
// IMPORTANT: this only edits in-memory demo data. It does not evaluate
// payment policy, sign anything, call a backend or touch a wallet. Approving a
// request here just changes a demo record's status.
//
// A transition that is not allowed returns the SAME state object, so callers
// can detect "nothing happened" with ===.

import { formatNear } from '../lib/money.js';

function appendAudit(state, { ts, actor = 'demo-owner', event, entityId, agentId, summary }) {
  const seq = state.audit.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
  return { ...state, audit: [...state.audit, { seq, ts, actor, event, entityId, agentId, summary }] };
}

function agentOf(state, agentId) {
  return state.agents.find((a) => a.id === agentId);
}

export function reducer(state, action) {
  switch (action.type) {
    case 'agent/create': {
      const { id, now, values } = action;
      if (!id || state.agents.some((a) => a.id === id)) return state;
      const agent = {
        id,
        name: values.name,
        status: 'ACTIVE',
        sourceAccount: values.sourceAccount,
        dailyBudget: values.dailyBudget,
        perTxLimit: values.perTxLimit,
        approvalThreshold: values.approvalThreshold,
        createdAt: now,
        updatedAt: now,
      };
      return appendAudit(
        { ...state, agents: [...state.agents, agent] },
        { ts: now, event: 'AGENT_CREATED', entityId: id, agentId: id, summary: `${agent.name} was created.` },
      );
    }

    case 'agent/updateLimits': {
      const { agentId, now, values } = action;
      const agent = agentOf(state, agentId);
      if (!agent) return state;
      const next = {
        ...agent,
        dailyBudget: values.dailyBudget,
        perTxLimit: values.perTxLimit,
        approvalThreshold: values.approvalThreshold,
        updatedAt: now,
      };
      return appendAudit(
        { ...state, agents: state.agents.map((a) => (a.id === agentId ? next : a)) },
        {
          ts: now,
          event: 'AGENT_LIMITS_UPDATED',
          entityId: agentId,
          agentId,
          summary: `Limits for ${agent.name} updated: daily ${formatNear(next.dailyBudget)}, per-transaction ${formatNear(next.perTxLimit)}, approval threshold ${formatNear(next.approvalThreshold)} NEAR.`,
        },
      );
    }

    case 'agent/setStatus': {
      const { agentId, status, now } = action;
      const agent = agentOf(state, agentId);
      if (!agent || (status !== 'ACTIVE' && status !== 'PAUSED') || agent.status === status) return state;
      return appendAudit(
        {
          ...state,
          agents: state.agents.map((a) => (a.id === agentId ? { ...a, status, updatedAt: now } : a)),
        },
        {
          ts: now,
          event: status === 'PAUSED' ? 'AGENT_PAUSED' : 'AGENT_RESUMED',
          entityId: agentId,
          agentId,
          summary: `${agent.name} was ${status === 'PAUSED' ? 'paused' : 'resumed'}.`,
        },
      );
    }

    case 'recipient/set': {
      const { agentId, now, id, values } = action;
      const agent = agentOf(state, agentId);
      if (!agent) return state;
      const existing = state.recipients.find(
        (r) => r.agentId === agentId && r.accountId === values.accountId,
      );
      const listName = values.listType === 'ALLOW' ? 'allow' : 'block';
      if (existing) {
        const updated = { ...existing, listType: values.listType, note: values.note };
        return appendAudit(
          { ...state, recipients: state.recipients.map((r) => (r === existing ? updated : r)) },
          { ts: now, event: 'RECIPIENT_UPDATED', entityId: values.accountId, agentId, summary: `${values.accountId} is now on the ${listName} list of ${agent.name}.` },
        );
      }
      if (!id) return state;
      const created = { id, agentId, accountId: values.accountId, listType: values.listType, note: values.note, createdAt: now };
      return appendAudit(
        { ...state, recipients: [...state.recipients, created] },
        { ts: now, event: 'RECIPIENT_ADDED', entityId: values.accountId, agentId, summary: `${values.accountId} added to the ${listName} list of ${agent.name}.` },
      );
    }

    case 'recipient/remove': {
      const { agentId, accountId, now } = action;
      const agent = agentOf(state, agentId);
      const existing = state.recipients.find((r) => r.agentId === agentId && r.accountId === accountId);
      if (!agent || !existing) return state;
      return appendAudit(
        { ...state, recipients: state.recipients.filter((r) => r !== existing) },
        { ts: now, event: 'RECIPIENT_REMOVED', entityId: accountId, agentId, summary: `${accountId} removed from the lists of ${agent.name}.` },
      );
    }

    case 'approval/decide': {
      const { requestId, decision, comment = null, now } = action;
      const req = state.requests.find((r) => r.id === requestId);
      if (!req || req.status !== 'APPROVAL_REQUIRED') return state;
      if (decision !== 'APPROVE' && decision !== 'REJECT') return state;
      const approve = decision === 'APPROVE';
      const updated = {
        ...req,
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedAt: now,
        decisionComment: comment,
      };
      const agent = agentOf(state, req.agentId);
      return appendAudit(
        { ...state, requests: state.requests.map((r) => (r.id === requestId ? updated : r)) },
        {
          ts: now,
          event: approve ? 'PAYMENT_APPROVED' : 'PAYMENT_REJECTED',
          entityId: requestId,
          agentId: req.agentId,
          summary: `Request ${requestId} (${formatNear(req.amount)} NEAR, ${agent ? agent.name : 'unknown agent'}) was ${approve ? 'approved' : 'rejected'}.`,
        },
      );
    }

    default:
      return state;
  }
}
