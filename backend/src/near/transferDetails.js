// Stage 3b-4, piece 1: do the transaction's identity and transfer details match
// the authorization, regardless of whether the transaction succeeded?
//
// Pure: no I/O, no clock, no randomness. Returns a strict boolean and never
// throws; anything unexpected is false.
//
// This exists because matchAuthorization checks execution FIRST and returns
// EXECUTION_NOT_OK before it looks at the hash, signer, receiver, actions or
// amount. For a failed transaction that is not enough to decide whether the
// failure belongs to the authorized payment, so the service asks this helper
// (transferDetailsMatch in verifyTransfer) before it may release a reservation.
//
// It deliberately does NOT import matchAuthorization or checkExecution: the two
// are kept independent, and a cross-check test fails if they ever disagree.
//
//   result:        a NEAR RPC `tx` result
//   authorization: { txHash, signerId, receiverId, amount } with exactly those keys
//                  (amount is a yoctoNEAR digit string)

const AUTH_KEYS = ['amount', 'receiverId', 'signerId', 'txHash'];
const HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{32,50}$/;
const AMOUNT_RE = /^[1-9][0-9]{0,39}$/;
const DEPOSIT_RE = /^(0|[1-9][0-9]{0,39})$/;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAccount = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const hasExactKeys = (obj, keys) => {
  const actual = Object.keys(obj).sort();
  return actual.length === keys.length && actual.every((key, i) => key === keys[i]);
};

function validAuthorization(a) {
  return (
    isObject(a) &&
    hasExactKeys(a, AUTH_KEYS) &&
    typeof a.txHash === 'string' && HASH_RE.test(a.txHash) &&
    isAccount(a.signerId) &&
    isAccount(a.receiverId) &&
    typeof a.amount === 'string' && AMOUNT_RE.test(a.amount)
  );
}

function evaluate(result, auth) {
  if (!validAuthorization(auth)) return false;
  if (!isObject(result)) return false;

  const tx = result.transaction;
  const outcome = result.transaction_outcome;
  if (!isObject(tx) || !isObject(outcome)) return false;

  // Identity: the hash must agree in both places the RPC reports it.
  if (tx.hash !== auth.txHash || outcome.id !== auth.txHash) return false;
  if (tx.signer_id !== auth.signerId) return false;
  if (tx.receiver_id !== auth.receiverId) return false;

  // Exactly one action, and it is a plain Transfer with only a deposit.
  const actions = tx.actions;
  if (!Array.isArray(actions) || actions.length !== 1) return false;
  const action = actions[0];
  if (!isObject(action) || !hasExactKeys(action, ['Transfer'])) return false;
  const transfer = action.Transfer;
  if (!isObject(transfer) || !hasExactKeys(transfer, ['deposit'])) return false;

  // Exact amount, compared as BigInt (never as a Number).
  const deposit = transfer.deposit;
  if (typeof deposit !== 'string' || !DEPOSIT_RE.test(deposit)) return false;
  return BigInt(deposit) === BigInt(auth.amount);
}

export function transferDetailsMatch(result, authorization) {
  try {
    return evaluate(result, authorization) === true;
  } catch {
    return false;
  }
}
