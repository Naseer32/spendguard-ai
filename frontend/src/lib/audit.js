// Describing audit entries for the activity page.
//
// The backend audit log stores { event, entityId, payload }. It has no agent
// column and no summary text, so both are derived here from what is present.
// Chain hashes are never shown.

import { formatNear } from './money.js';

const KNOWN = Object.freeze({
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
  PAYMENT_APPROVED_BY_OWNER: 'Payment approved',
  PAYMENT_EXPIRED: 'Payment expired',
  PAYMENT_CANCELLED: 'Payment cancelled',
  PAYMENT_BLOCKED: 'Payment blocked',
  PAYMENT_SUBMITTED: 'Payment submitted',
  PAYMENT_EXECUTED: 'Payment executed',
  PAYMENT_FAILED: 'Payment failed',
  PAYMENT_MISMATCH: 'Transaction mismatch',
  PAYMENT_VERIFICATION_HOLD: 'Verification on hold',
  APPROVAL_REFUSED: 'Approval refused',
});

/** Event codes offered in the activity filter. */
export const AUDIT_EVENT_CODES = Object.freeze(Object.keys(KNOWN));

/** "PAYMENT_APPROVAL_REQUIRED" becomes "Payment approval required". */
function prettify(code) {
  const text = String(code).toLowerCase().replace(/_/g, ' ').trim();
  return text === '' ? 'Unknown event' : text[0].toUpperCase() + text.slice(1);
}

export function auditEventLabel(code) {
  return KNOWN[code] ?? prettify(code);
}

const str = (v) => (typeof v === 'string' ? v : null);

/** The agent an entry is about, or null when it cannot be told. */
export function agentIdOfEntry(entry, paymentsById = {}) {
  const p = entry.payload ?? {};
  if (entry.event.startsWith('AGENT_')) return entry.entityId;
  if (str(p.agentId)) return p.agentId;
  if (entry.entityId && paymentsById[entry.entityId]) return paymentsById[entry.entityId].agentId;
  return null;
}

/** Adds { agentId, summary } to a mapped audit entry. */
export function describeEntry(entry, { agentsById = {}, paymentsById = {} } = {}) {
  const agentId = agentIdOfEntry(entry, paymentsById);
  const agentName = agentId && agentsById[agentId] ? agentsById[agentId].name : agentId ? 'an agent' : 'an agent';
  const p = entry.payload ?? {};
  const amount = typeof p.amount === 'string' ? `${formatNear(p.amount)} NEAR` : null;
  const shortId = entry.entityId ? entry.entityId.slice(0, 8) : '';
  let summary;

  switch (entry.event) {
    case 'AGENT_CREATED':
      summary = `${str(p.name) ?? agentName} was created.`;
      break;
    case 'AGENT_LIMITS_UPDATED':
      summary = `Spending limits for ${agentName} were updated.`;
      break;
    case 'AGENT_PAUSED':
      summary = `${agentName} was paused.`;
      break;
    case 'AGENT_RESUMED':
      summary = `${agentName} was resumed.`;
      break;
    case 'AGENT_KEY_ROTATED':
      summary = `The API key for ${agentName} was rotated.`;
      break;
    case 'RECIPIENT_ADDED':
    case 'RECIPIENT_UPDATED': {
      const list = p.listType === 'BLOCK' ? 'block' : p.listType === 'ALLOW' ? 'allow' : null;
      summary = `${str(p.accountId) ?? 'A recipient'} ${entry.event === 'RECIPIENT_ADDED' ? 'was added to' : 'is now on'}${list ? ` the ${list} list of` : ' the lists of'} ${agentName}.`;
      break;
    }
    case 'RECIPIENT_REMOVED':
      summary = `${str(p.accountId) ?? 'A recipient'} was removed from the lists of ${agentName}.`;
      break;
    case 'PAYMENT_EVALUATED':
      summary = `${agentName}: payment${amount ? ` of ${amount}` : ''} was evaluated${str(p.status) ? ` (${p.status})` : ''}.`;
      break;
    default:
      if (entry.event.startsWith('PAYMENT_')) {
        const to = str(p.to);
        summary = `Payment request ${shortId}${amount ? ` (${amount})` : ''}${to ? ` is now ${to}` : ': ' + auditEventLabel(entry.event).toLowerCase()}.`;
      } else {
        summary = `${auditEventLabel(entry.event)}${entry.entityId ? ` (${shortId})` : ''}.`;
      }
  }
  return { ...entry, agentId, summary };
}
