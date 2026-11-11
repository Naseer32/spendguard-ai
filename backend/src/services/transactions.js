// Stage 3b-5 piece A: the owner reports a transaction hash for an APPROVED
// payment and we verify it on-chain.
//
// Three phases, because the RPC call cannot run inside a SQLite write
// transaction (withWriteTransaction is synchronous):
//   1. write: APPROVED -> SUBMITTED, insert the transactions row (PENDING)
//   2. no transaction: verifyOnChain (RPC calls)
//   3. write: apply the verdict (EXECUTED / FAILED / MISMATCH), or leave the
//      request SUBMITTED for HOLD (audited) and INCONCLUSIVE (nothing written)
//
// Authorization signer is the agent's source_account from the database, never
// the reported value. Reporting again for a SUBMITTED request with the same
// hash retries the verification.

import { appendAudit } from '../audit/auditChain.js';
import { withWriteTransaction } from '../db/database.js';
import { verifyOnChain } from '../near/verifyOnChain.js';
import { VERDICTS } from '../near/verifyTransfer.js';
import { STATUS } from '../policy/lifecycle.js';
import { ConflictError, ValidationError } from './errors.js';
import { requireRequestRow, toRequestView, transitionRequest } from './requestState.js';
import { assertPlainObject, newId, rejectUnknownFields, requireContext } from './util.js';

const HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{32,50}$/;

function parseReport(input) {
  assertPlainObject(input, 'input');
  rejectUnknownFields(input, ['txHash', 'signerId']);
  if (typeof input.txHash !== 'string' || !HASH_RE.test(input.txHash)) {
    throw new ValidationError('txHash must be a NEAR transaction hash', 'txHash');
  }
  if (typeof input.signerId !== 'string' || input.signerId.length < 2 || input.signerId.length > 64) {
    throw new ValidationError('signerId must be a NEAR account id', 'signerId');
  }
  return { txHash: input.txHash, signerId: input.signerId };
}

function phaseOne(db, requestId, report, context, ctx) {
  return withWriteTransaction(db, () => {
    const row = requireRequestRow(db, requestId);
    const agent = db.prepare('SELECT source_account FROM agents WHERE id = ?').get(row.agent_id);
    if (agent === undefined || agent.source_account !== report.signerId) {
      throw new ConflictError('signerId is not the agent source account', 'SIGNER_NOT_SOURCE');
    }

    if (row.status === STATUS.SUBMITTED) {
      const tx = db.prepare('SELECT near_tx_hash, submitted_at FROM transactions WHERE request_id = ?').get(row.id);
      if (tx === undefined || tx.near_tx_hash !== report.txHash) {
        throw new ConflictError('a different transaction was already reported', 'HASH_DIFFERS');
      }
      return { row, sourceAccount: agent.source_account, submittedAt: tx.submitted_at };
    }

    if (row.status !== STATUS.APPROVED) {
      throw new ConflictError(`request is ${row.status}; only APPROVED requests can report a transaction`, 'NOT_REPORTABLE');
    }
    if (row.expires_at !== null && row.expires_at <= ctx.nowIso) {
      throw new ConflictError('the authorization window has passed', 'REQUEST_EXPIRED');
    }
    const used = db.prepare('SELECT request_id FROM transactions WHERE near_tx_hash = ?').get(report.txHash);
    if (used !== undefined) {
      throw new ConflictError('this transaction hash is already used', 'HASH_ALREADY_USED');
    }

    db.prepare(
      `INSERT INTO transactions (id, request_id, near_tx_hash, signer_account_id, verification_status, submitted_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?)`,
    ).run(newId(), row.id, report.txHash, report.signerId, ctx.nowIso);
    transitionRequest(db, row.id, STATUS.SUBMITTED, context, {
      event: 'PAYMENT_SUBMITTED',
      payload: { txHash: report.txHash },
    });
    return { row, sourceAccount: agent.source_account, submittedAt: ctx.nowIso };
  });
}

const FINAL = Object.freeze({
  [VERDICTS.VERIFIED]: { to: STATUS.EXECUTED, txStatus: 'VERIFIED', event: 'PAYMENT_EXECUTED' },
  [VERDICTS.FAILED]: { to: STATUS.FAILED, txStatus: 'FAILED', event: 'PAYMENT_FAILED' },
  [VERDICTS.MISMATCH]: { to: STATUS.MISMATCH, txStatus: 'MISMATCH', event: 'PAYMENT_MISMATCH' },
});

function phaseThree(db, requestId, txHash, outcome, context, ctx, auditHold = true) {
  return withWriteTransaction(db, () => {
    const row = requireRequestRow(db, requestId);
    if (row.status !== STATUS.SUBMITTED) return toRequestView(row); // settled meanwhile

    const final = FINAL[outcome.verdict];
    if (final !== undefined) {
      transitionRequest(db, row.id, final.to, context, {
        event: final.event,
        payload: { txHash, verdict: outcome.verdict, reason: outcome.reason },
      });
      db.prepare(
        `UPDATE transactions SET verification_status = ?, verification_detail = ?, verified_at = ? WHERE request_id = ?`,
      ).run(final.txStatus, JSON.stringify({ verdict: outcome.verdict, reason: outcome.reason }), ctx.nowIso, row.id);
    } else if (outcome.verdict === VERDICTS.HOLD && auditHold) {
      appendAudit(db, {
        ts: ctx.nowIso,
        actor: ctx.actor,
        event: 'PAYMENT_VERIFICATION_HOLD',
        entityId: row.id,
        payload: { txHash, reason: outcome.reason },
      });
    }
    // INCONCLUSIVE: nothing is written.
    return toRequestView(requireRequestRow(db, row.id));
  });
}

// input: { txHash, signerId }. rpc: { call(method, params) }.
// Returns { verdict, action, reason, request }.
export async function reportTransaction(db, rpc, requestId, input, context, options = {}) {
  const ctx = requireContext(context);
  const report = parseReport(input);

  const { row, sourceAccount, submittedAt } = phaseOne(db, requestId, report, context, ctx);

  const outcome = await verifyOnChain({
    rpc,
    authorization: {
      txHash: report.txHash,
      signerId: sourceAccount,
      receiverId: row.recipient,
      amount: row.amount,
    },
    authorizedAt: row.decided_at ?? row.created_at,
    submittedAt,
    now: ctx.nowIso,
    hashAlreadyUsed: false, // the UNIQUE hash column already guarantees it is ours
  });

  const request = phaseThree(db, requestId, report.txHash, outcome, context, ctx, options.auditHold !== false);
  return { verdict: outcome.verdict, action: outcome.action, reason: outcome.reason, request };
}

// SUBMITTED requests with a reported hash, oldest first.
export function listSubmittedForReverify(db, limit) {
  return db
    .prepare(
      `SELECT r.id AS request_id, t.near_tx_hash AS tx_hash, t.signer_account_id AS signer_id
         FROM payment_requests r JOIN transactions t ON t.request_id = r.id
        WHERE r.status = 'SUBMITTED'
        ORDER BY t.submitted_at ASC, r.id ASC
        LIMIT ?`,
    )
    .all(limit);
}

// Re-verifies stuck SUBMITTED requests one at a time (gentle on the RPC).
// Never throws. A repeated HOLD is not audited again. Returns counts.
export async function reverifySubmitted(db, rpc, context, { limit = 20 } = {}) {
  const counts = { checked: 0, settled: 0, inconclusive: 0, held: 0, errors: 0 };
  let rows;
  try {
    rows = listSubmittedForReverify(db, limit);
  } catch {
    counts.errors += 1;
    return counts;
  }
  for (const row of rows) {
    counts.checked += 1;
    try {
      const res = await reportTransaction(
        db, rpc, row.request_id, { txHash: row.tx_hash, signerId: row.signer_id }, context, { auditHold: false },
      );
      if (res.verdict === VERDICTS.INCONCLUSIVE) counts.inconclusive += 1;
      else if (res.verdict === VERDICTS.HOLD) counts.held += 1;
      else counts.settled += 1;
    } catch {
      counts.errors += 1;
    }
  }
  return counts;
}
