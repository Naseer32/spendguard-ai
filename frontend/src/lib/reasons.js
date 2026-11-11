// Human-readable text for policy reason codes (backend/src/policy/reasonCodes.js)
// and audit event types. Unknown codes fall back to the raw code so a new
// backend value is visible instead of hidden.

export const REASON_INFO = Object.freeze({
  WITHIN_POLICY: { label: 'Within policy', text: 'The request is inside every limit.', tone: 'success' },
  AGENT_PAUSED: { label: 'Agent paused', text: 'The agent is paused, so all of its payments are blocked.', tone: 'danger' },
  INVALID_RECIPIENT: { label: 'Invalid recipient', text: 'The recipient is not a valid NEAR account ID.', tone: 'danger' },
  RECIPIENT_BLOCKED: { label: 'Recipient blocked', text: 'The recipient is on the agent\'s block list.', tone: 'danger' },
  INVALID_AMOUNT: { label: 'Invalid amount', text: 'The amount is not a valid number.', tone: 'danger' },
  ZERO_AMOUNT: { label: 'Zero amount', text: 'The amount is zero.', tone: 'danger' },
  EXCEEDS_TX_LIMIT: { label: 'Over per-transaction limit', text: 'The amount is above the agent\'s per-transaction limit.', tone: 'danger' },
  EXCEEDS_DAILY_BUDGET: { label: 'Over daily budget', text: 'The amount is more than the budget left today.', tone: 'danger' },
  INVALID_AGENT_CONFIG: { label: 'Invalid agent config', text: 'The agent\'s configuration is invalid, so the request fails closed.', tone: 'danger' },
  INVALID_CONTEXT: { label: 'Invalid context', text: 'The evaluation input was malformed, so the request fails closed.', tone: 'danger' },
  INTERNAL_ERROR: { label: 'Internal error', text: 'An internal error occurred, so the request fails closed.', tone: 'danger' },
  RECIPIENT_NOT_ALLOWLISTED: { label: 'Recipient not on allow list', text: 'The recipient is unknown to this agent and needs a human decision.', tone: 'warning' },
  ABOVE_APPROVAL_THRESHOLD: { label: 'Above approval threshold', text: 'The amount is above the level that needs human approval.', tone: 'warning' },
});

export function reasonLabel(code) {
  return REASON_INFO[code]?.label ?? String(code);
}

export const EVENT_INFO = Object.freeze({
  AGENT_CREATED: 'Agent created',
  AGENT_LIMITS_UPDATED: 'Limits updated',
  AGENT_PAUSED: 'Agent paused',
  AGENT_RESUMED: 'Agent resumed',
  AGENT_KEY_ROTATED: 'API key rotated',
  RECIPIENT_ADDED: 'Recipient added',
  RECIPIENT_UPDATED: 'Recipient updated',
  RECIPIENT_REMOVED: 'Recipient removed',
  PAYMENT_EVALUATED: 'Payment evaluated',
  PAYMENT_APPROVED: 'Payment approved',
  PAYMENT_REJECTED: 'Payment rejected',
});

export function eventLabel(code) {
  return EVENT_INFO[code] ?? String(code);
}
