// Evaluates a payment against an agent's CURRENT limits, recipient lists and
// today's reserved budget. Read-only. Used to re-check a request when a human
// approves it, so approval cannot override a rule that now blocks the payment.
//
// payments.js builds the same snapshot when a request is first evaluated; a
// test keeps the two identical.

import { utcBudgetDay } from '../policy/budget.js';
import { evaluatePayment } from '../policy/engine.js';
import { getAgent } from './agents.js';
import { getRecipientLists } from './recipients.js';
import { reservedForDay } from './reservations.js';

// request: { recipient, amount }. Returns { result, snapshot }.
export function evaluateCurrentPolicy(db, agentId, request, nowMs) {
  const agent = getAgent(db, agentId);
  const lists = getRecipientLists(db, agent.id, request.recipient);
  const budgetDay = utcBudgetDay(nowMs);
  const reservedToday = reservedForDay(db, agent.id, budgetDay);
  const agentPolicy = {
    status: agent.status,
    dailyBudget: agent.dailyBudget,
    perTxLimit: agent.perTxLimit,
    approvalThreshold: agent.approvalThreshold,
  };

  const result = evaluatePayment({
    agent: agentPolicy,
    recipientLists: lists,
    reservedToday,
    request: { recipient: request.recipient, amount: request.amount },
  });

  const snapshot = {
    agent: agentPolicy,
    recipientLists: { onAllowlist: lists.onAllowlist, onBlocklist: lists.onBlocklist },
    reservedToday,
    budgetDay,
    remainingBudget: result.remainingBudget,
  };
  return { result, snapshot };
}
