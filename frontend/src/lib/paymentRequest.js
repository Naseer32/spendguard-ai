// Validation for the "Request a payment" form: the owner acts as the agent, using the agent's API key,
// to ask SpendGuard to evaluate a payment. Pure and unit-tested.

import { nearToYocto } from './money.js';
import { isValidNearAccountId } from './validation.js';

const KEY_RE = /^sgk_[A-Za-z0-9_-]{16,300}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
export const MAX_PURPOSE_LENGTH = 500;

/** A fresh idempotency key (backend rule: 8 to 128 characters of letters, digits, . _ : -). */
export function newIdempotencyKey(random = () => globalThis.crypto.randomUUID()) {
  return `dash-${random()}`;
}

/**
 * input: { recipient, amount (NEAR text), purpose, agentKey }; agent: { id }
 * Resolves { ok, errors, value: { recipient, amount (yocto), purpose, agentKey } }.
 */
export function validatePaymentRequest(input, agent) {
  const errors = {};
  const recipient = typeof input.recipient === 'string' ? input.recipient.trim() : '';
  if (recipient === '') errors.recipient = 'Enter the recipient NEAR account.';
  else if (!isValidNearAccountId(recipient)) errors.recipient = 'Enter a valid NEAR account ID (for example bob.testnet).';

  const amount = nearToYocto(typeof input.amount === 'string' ? input.amount : '');
  if (amount === null) errors.amount = 'Enter an amount in NEAR, for example 0.1 (up to 24 decimals).';
  else if (amount === '0') errors.amount = 'The amount must be greater than zero.';

  const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
  if (purpose.length > MAX_PURPOSE_LENGTH || CONTROL_CHARS_RE.test(purpose)) {
    errors.purpose = `Use at most ${MAX_PURPOSE_LENGTH} characters, without control characters.`;
  }

  const agentKey = typeof input.agentKey === 'string' ? input.agentKey.trim() : '';
  if (agentKey === '') errors.agentKey = "Enter this agent's API key.";
  else if (!KEY_RE.test(agentKey)) errors.agentKey = 'That does not look like an agent API key (it starts with sgk_).';
  else if (agent?.id && !agentKey.startsWith(`sgk_${agent.id}_`)) errors.agentKey = 'This key belongs to a different agent.';

  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { recipient, amount, purpose: purpose === '' ? null : purpose, agentKey } : null };
}
