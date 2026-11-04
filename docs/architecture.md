# SpendGuard AI: Architecture (v2, approved)

## Purpose

SpendGuard AI is a security layer for funds controlled by autonomous AI agents.
Agents ask SpendGuard to evaluate each payment. A deterministic policy engine
decides; AI only explains.

## Principles

- **Deterministic policy.** The policy engine is pure and total: no I/O, no AI,
  no clock, no randomness. It never throws; bad input fails closed to BLOCKED.
- **AI never decides.** AI output is advisory text, stored separately, and
  never read by decision code. If the provider fails, a template explanation
  is used.
- **No private keys.** SpendGuard never stores or handles private keys or seed
  phrases. The owner signs transactions in their own wallet.
- **No fake chain data.** A payment is EXECUTED only after its transaction
  hash is verified through NEAR RPC.
- **Money is exact.** Native NEAR only. Amounts are yoctoNEAR strings
  (1 NEAR = 10^24) with BigInt arithmetic. Floating point is never used.
- **Simple.** Node.js 24.15+, built-in `node:sqlite`, no native compilation.

## Custody model (Option B, MVP)

SpendGuard evaluates and authorizes payment requests. The owner signs the real
NEAR Testnet transfer in their connected wallet and reports the transaction
hash. The backend verifies it on-chain.

Limitation: SpendGuard cannot physically stop an owner from sending other
transfers. It detects and flags transactions that do not match an
authorization. A restricted vault contract that enforces limits on-chain is a
possible later improvement.

## Components

```
Agent -> POST /api/v1/payments/evaluate (agent key + idempotency key)
          |
          v
      Express API -> Policy Engine (pure) -> decision + reason codes
          |                |
          |                +-> AI Explainer (text only, after the decision)
          +-> SQLite (node:sqlite)
          +-> Owner dashboard (React); owner signs in their wallet
                    |
                    v
              NEAR Testnet <- backend verifies the tx hash via RPC
```

## Policy engine

Input: agent limits and status, recipient list membership, budget already
reserved today, and the request (recipient, amount).

Output: `{ decision, reasonCodes, remainingBudget }`.

All rules are evaluated and every triggered reason is returned. Severity is
BLOCKED > APPROVAL_REQUIRED > APPROVED.

| Outcome | Reason codes |
|---|---|
| BLOCKED | AGENT_PAUSED, INVALID_RECIPIENT, RECIPIENT_BLOCKED, INVALID_AMOUNT, ZERO_AMOUNT, EXCEEDS_TX_LIMIT, EXCEEDS_DAILY_BUDGET, INVALID_AGENT_CONFIG, INVALID_CONTEXT, INTERNAL_ERROR |
| APPROVAL_REQUIRED | RECIPIENT_NOT_ALLOWLISTED, ABOVE_APPROVAL_THRESHOLD |
| APPROVED | WITHIN_POLICY |

## Payment lifecycle

`decision` is the immutable engine output. `status` is the lifecycle position.

```
evaluate -> BLOCKED
         -> APPROVAL_REQUIRED -> APPROVED | REJECTED | EXPIRED | BLOCKED
         -> APPROVED
APPROVED  -> SUBMITTED | EXPIRED | CANCELLED
SUBMITTED -> EXECUTED | FAILED | MISMATCH
```

APPROVED never means EXECUTED. EXECUTED is reachable only from SUBMITTED,
after on-chain verification.

### Budget reservations

| Event | Reservation |
|---|---|
| Becomes APPROVED (auto or by human) | created ACTIVE |
| EXECUTED | CONSUMED |
| EXPIRED, CANCELLED, FAILED | RELEASED |
| MISMATCH | stays held (conservative) |
| BLOCKED, REJECTED, pending APPROVAL_REQUIRED | none |

- Budget used = ACTIVE + CONSUMED reservations for the request's UTC budget
  day. The day is fixed when the reservation is created.
- When the owner approves, the policy is re-run against current rules and
  budget inside one write transaction. If it now fails, the request becomes
  BLOCKED and the approval is refused.
- Concurrency control: `BEGIN IMMEDIATE`, WAL mode, busy timeout. Amounts are
  summed in JavaScript with BigInt, never with SQL `SUM`.
- APPROVED requests expire after a configurable window (default 60 minutes).

## On-chain verification

The owner reports `tx_hash` and signer account. The backend checks via NEAR
RPC:

1. Chain ID is `testnet`.
2. Signer equals the agent's configured source account.
3. Receiver equals the authorized recipient.
4. A single Transfer action with a deposit exactly equal to the authorized
   amount.
5. Final execution outcome is success, at final finality.
6. Block time is after the authorization time, and the hash is unique across
   all requests.

## Database (node:sqlite)

Tables: `agents`, `recipients`, `payment_requests`, `budget_reservations`,
`approvals`, `transactions`, `audit_log`.

- Amounts are TEXT with CHECK constraints (digits only, at most 40 characters).
- Timestamps are UTC ISO strings.
- Idempotency: unique `(agent_id, idempotency_key)`. Same key and body returns
  the original response; same key with a different body returns 409.
- Audit: `hash = SHA-256(canonical JSON of prev_hash, ts, actor, event,
  entity_id, payload)`, written in the same transaction as the state change.
  It is **tamper-evident, not immutable**: someone with full database write
  access could rebuild the chain, so the latest head hash should be compared
  externally.

## API (planned)

- Agent: `POST /api/v1/payments/evaluate`, `GET /api/v1/payments/:id`
- Owner: agents, limits, recipients, payments, approvals, tx reporting and
  verification, cancel, audit and audit verification, health
- Every owner route sits behind a default-deny `requireOwner` guard. A test
  enumerates all routes and fails if any non-allowlisted route is
  unauthenticated.
- Strict validation on every body and parameter; unknown fields rejected.

## Security

- No secrets in the repo, frontend or logs; authorization headers and API keys
  are redacted.
- Agent API keys are random, shown once, stored hashed, compared in constant
  time.
- Fail closed on any evaluation error.
- AI receives only the decision, reason codes, amount and recipient. The
  `purpose` text is capped and treated as untrusted. AI output is never parsed
  for decisions.

## Stages

1. Policy engine, money math, lifecycle state machine, CI (pure code, zero
   dependencies). **This stage.**
2. Database, reservations, audit chain, API with auth, idempotency, evaluate
   and approve/reject.
3. NEAR RPC verifier and tx-report endpoint, tested on real testnet.
4. Mobile-first dashboard, wallet connect and signing, wallet sign-in.
5. AI explainer via NEAR AI Cloud (provider interface plus template fallback).
6. Hardening, demo script, README and video.

## Testing

- Runner: Node's built-in `node:test`.
- Stage 1 tests cover every rule and boundary of the policy engine, money
  math, budget days, the lifecycle state machine, and a static guard that
  keeps `money/` and `policy/` free of I/O, AI, database, floats and clock
  calls.
- Later stages add API tests (idempotency, concurrency, auth), AI tests (a
  hostile explainer must not change decisions) and real-testnet verification
  tests.
- CI runs everything on Node 24 for every push.
