// Payment status vocabulary used by the UI.
//
// Request statuses mirror the backend lifecycle (backend/src/db/schema.js):
// BLOCKED, APPROVAL_REQUIRED, APPROVED, REJECTED, EXPIRED, CANCELLED,
// SUBMITTED, EXECUTED, FAILED, MISMATCH. PENDING is an extra neutral label kept
// from Stage F1. Per the architecture doc, APPROVED never means EXECUTED:
// EXECUTED is only reachable after on-chain verification.
//
// Tone names map to static class strings in StatusBadge so Tailwind can see them.

export const STATUS = Object.freeze({
  APPROVED: 'APPROVED',
  BLOCKED: 'BLOCKED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  PENDING: 'PENDING',
  EXECUTED: 'EXECUTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  SUBMITTED: 'SUBMITTED',
  FAILED: 'FAILED',
  MISMATCH: 'MISMATCH',
});

export const STATUS_META = Object.freeze({
  APPROVED: {
    label: 'Approved',
    tone: 'success',
    description: 'Within policy. Authorised, but not yet sent on-chain.',
  },
  BLOCKED: {
    label: 'Blocked',
    tone: 'danger',
    description: 'Violates a hard rule such as a limit or a blocked recipient.',
  },
  APPROVAL_REQUIRED: {
    label: 'Approval required',
    tone: 'warning',
    description: 'Needs a human decision before it can proceed.',
  },
  PENDING: {
    label: 'Pending',
    tone: 'neutral',
    description: 'Waiting for the next step.',
  },
  EXECUTED: {
    label: 'Executed',
    tone: 'accent',
    description: 'Transaction verified on-chain.',
  },
  REJECTED: {
    label: 'Rejected',
    tone: 'danger',
    description: 'A human declined this request.',
  },
  EXPIRED: {
    label: 'Expired',
    tone: 'neutral',
    description: 'The approval window passed before it was used.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'neutral',
    description: 'Cancelled before it was sent.',
  },
  SUBMITTED: {
    label: 'Submitted',
    tone: 'accent',
    description: 'Reported as sent; waiting for on-chain verification.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'danger',
    description: 'The transaction failed on-chain.',
  },
  MISMATCH: {
    label: 'Mismatch',
    tone: 'warning',
    description: 'The transaction did not match what was authorised.',
  },
});

// The five statuses highlighted in the Overview status guide.
export const STATUS_ORDER = Object.freeze([
  STATUS.APPROVED,
  STATUS.APPROVAL_REQUIRED,
  STATUS.BLOCKED,
  STATUS.PENDING,
  STATUS.EXECUTED,
]);

// Statuses a payment request can have in the backend lifecycle (filters).
export const REQUEST_STATUS_OPTIONS = Object.freeze([
  STATUS.APPROVAL_REQUIRED,
  STATUS.APPROVED,
  STATUS.SUBMITTED,
  STATUS.EXECUTED,
  STATUS.BLOCKED,
  STATUS.REJECTED,
  STATUS.EXPIRED,
  STATUS.CANCELLED,
  STATUS.FAILED,
  STATUS.MISMATCH,
]);

// Statuses that count toward today's budget (ACTIVE + CONSUMED reservations).
export const BUDGET_HOLDING_STATUSES = Object.freeze([
  STATUS.APPROVED,
  STATUS.SUBMITTED,
  STATUS.EXECUTED,
  STATUS.MISMATCH,
]);
