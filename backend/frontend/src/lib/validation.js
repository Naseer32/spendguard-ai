// Client-side form validation. These checks give instant feedback only; they
// mirror the backend rules (backend/src/services/agents.js,
// backend/src/policy/engine.js) and the backend remains the source of truth.

import { compareYocto, nearToYocto } from './money.js';

// Same pattern as the backend: lowercase alphanumeric parts separated by
// "-", "_" or ".", 2 to 64 characters.
const ACCOUNT_ID_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

export const RECIPIENT_LIST_TYPES = Object.freeze(['ALLOW', 'BLOCK']);
export const MAX_NAME_LENGTH = 100;
export const MAX_NOTE_LENGTH = 500;

export function isValidNearAccountId(value) {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 64 &&
    ACCOUNT_ID_RE.test(value)
  );
}

function hasControlCharacters(value) {
  return CONTROL_CHARS_RE.test(value);
}

function checkName(raw, errors) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length < 1) {
    errors.name = 'Enter a name.';
  } else if (name.length > MAX_NAME_LENGTH || hasControlCharacters(name)) {
    errors.name = `Use 1 to ${MAX_NAME_LENGTH} characters, without control characters.`;
  }
  return name;
}

function checkAmount(raw, field, label, errors, { allowZero }) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    errors[field] = `Enter ${label}.`;
    return null;
  }
  const yocto = nearToYocto(text);
  if (yocto === null) {
    errors[field] = 'Enter a number in NEAR with at most 24 decimals, e.g. 12.5.';
    return null;
  }
  if (!allowZero && yocto === '0') {
    errors[field] = `${label[0].toUpperCase()}${label.slice(1)} must be greater than 0.`;
    return null;
  }
  return yocto;
}

/**
 * Validate the three spending limits (inputs are decimal NEAR text).
 * Rule from the backend: approvalThreshold <= perTxLimit <= dailyBudget.
 * Returns { ok, errors, value } where value holds yoctoNEAR strings.
 */
export function validateLimits(input) {
  const errors = {};
  const dailyBudget = checkAmount(input.dailyBudget, 'dailyBudget', 'a daily budget', errors, { allowZero: false });
  const perTxLimit = checkAmount(input.perTxLimit, 'perTxLimit', 'a per-transaction limit', errors, { allowZero: false });
  const approvalThreshold = checkAmount(input.approvalThreshold, 'approvalThreshold', 'an approval threshold', errors, { allowZero: true });

  if (perTxLimit && dailyBudget && compareYocto(perTxLimit, dailyBudget) > 0 && !errors.perTxLimit) {
    errors.perTxLimit = 'Per-transaction limit must not exceed the daily budget.';
  }
  if (approvalThreshold && perTxLimit && compareYocto(approvalThreshold, perTxLimit) > 0 && !errors.approvalThreshold) {
    errors.approvalThreshold = 'Approval threshold must not exceed the per-transaction limit.';
  }

  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { dailyBudget, perTxLimit, approvalThreshold } : null };
}

export function validateAgentForm(input) {
  const errors = {};
  const name = checkName(input.name, errors);

  const sourceAccount = typeof input.sourceAccount === 'string' ? input.sourceAccount.trim() : '';
  if (sourceAccount === '') {
    errors.sourceAccount = 'Enter the source account.';
  } else if (!isValidNearAccountId(sourceAccount)) {
    errors.sourceAccount = 'Enter a valid NEAR account ID (lowercase letters, digits, "-", "_", ".").';
  }

  const limits = validateLimits(input);
  Object.assign(errors, limits.errors);

  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name, sourceAccount, ...limits.value } : null };
}

export function validateRecipientForm(input) {
  const errors = {};
  const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
  if (accountId === '') {
    errors.accountId = 'Enter a NEAR account ID.';
  } else if (!isValidNearAccountId(accountId)) {
    errors.accountId = 'Enter a valid NEAR account ID (lowercase letters, digits, "-", "_", ".").';
  }

  if (!RECIPIENT_LIST_TYPES.includes(input.listType)) {
    errors.listType = 'Choose Allow or Block.';
  }

  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > MAX_NOTE_LENGTH || hasControlCharacters(note)) {
    errors.note = `Use at most ${MAX_NOTE_LENGTH} characters, without control characters.`;
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok ? { accountId, listType: input.listType, note: note === '' ? null : note } : null,
  };
}

export function validateComment(raw) {
  const comment = typeof raw === 'string' ? raw.trim() : '';
  if (comment.length > MAX_NOTE_LENGTH || hasControlCharacters(comment)) {
    return { ok: false, error: `Use at most ${MAX_NOTE_LENGTH} characters.`, value: null };
  }
  return { ok: true, error: null, value: comment === '' ? null : comment };
}
