import { assertPlainObject, rejectUnknownFields } from '../services/util.js';

// A JSON body must be a plain object that only uses the allowed keys.
// A missing body counts as an empty object, so required-field errors come
// from the service that owns the rules.
export function bodyObject(body, allowedKeys) {
  const source = body === undefined ? {} : body;
  assertPlainObject(source, 'body');
  rejectUnknownFields(source, allowedKeys);
  return source;
}

// What an agent may see of its own payment request. The policy snapshot
// (limits and remaining budget) and the AI explanation stay owner-only.
export function toAgentPaymentView(request) {
  return {
    id: request.id,
    recipient: request.recipient,
    amount: request.amount,
    purpose: request.purpose,
    decision: request.decision,
    status: request.status,
    reasonCodes: request.reasonCodes,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt,
    expiresAt: request.expiresAt,
    updatedAt: request.updatedAt,
  };
}
