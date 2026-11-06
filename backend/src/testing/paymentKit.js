// Test helpers for payment and request-state tests. Not imported by production code.

import { nearToYocto as N } from '../money/yocto.js';
import { evaluatePaymentRequest } from '../services/payments.js';
import { setRecipient } from '../services/recipients.js';
import { NOW, seedAgent, svc } from './serviceKit.js';

let counter = 0;

export function nextKey() {
  counter += 1;
  return `idem-key-${counter}`;
}

// Limits where a payment of up to 20 NEAR to an allowlisted recipient is
// auto-approved, against a daily budget of 100 NEAR.
export const budgetAgent = () => ({
  dailyBudget: N('100'),
  perTxLimit: N('20'),
  approvalThreshold: N('20'),
});

// Creates an agent and puts the given accounts on its allowlist. Returns the agent id.
export function setupAgent(db, agentOver = {}, allowed = ['merchant.testnet']) {
  const { agent } = seedAgent(db, agentOver);
  for (const accountId of allowed) {
    setRecipient(db, agent.id, { accountId, listType: 'ALLOW' }, svc());
  }
  return agent.id;
}

// Evaluates a payment request as the agent, at the given time (default NOW).
// Returns { request, replayed }.
export function pay(db, agentId, over = {}, now = NOW, settings = undefined) {
  const context = svc({ now, actor: `agent:${agentId}` });
  return evaluatePaymentRequest(
    db,
    agentId,
    { idempotencyKey: nextKey(), recipient: 'merchant.testnet', amount: N('1'), ...over },
    context,
    settings,
  );
}
