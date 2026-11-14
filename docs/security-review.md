# Security review (14 Nov 2026)

A read-only review of the backend, dashboard and agent demo, followed by fixes for the items that were safe to change before submission. All test suites pass after the fixes (backend, frontend, agent-demo). Nothing here has had an independent professional audit. This is a testnet MVP.

## Fixed

| Finding | Fix |
|---|---|
| The agent demo could send from the wrong account if its API key belonged to a different agent, and failed open when the limit check errored. | It now checks that the key's agent has `SOURCE_ACCOUNT` as its source account, and refuses to send if that cannot be confirmed. |
| The "private network" check for plain `http://` matched names like `10.evil.com` (dashboard and agent demo). | Only real loopback and private IP addresses count now. |
| The agent demo accepted any RPC host containing the word "testnet". | Exact allow-list of known NEAR testnet RPC hosts. |
| The dashboard compared the wallet account from page state, not the wallet's current account, at signing time. | The wallet's active account is re-read and must equal the agent's source account, or nothing is sent. |
| A wrong agent key in the new "Request a payment" form could be mistaken for a rejected owner token and disconnect the dashboard. | A rejected agent key is reported as a plain error. |

## Open (not fixed, known limits)

| Severity | Finding |
|---|---|
| Medium | A payment sent after its authorization window expires (or after the request was cancelled) cannot be reported, and its daily budget has already been released. |
| Medium | A transaction not found for 30 minutes is marked FAILED and releases its budget, but a delayed transaction can still land afterwards. |
| Medium | Nothing on the server stops the same APPROVED request from being paid twice from two places (two tabs, or the dashboard and the agent demo). The one-send guard is per browser tab. |
| Medium | The agent demo holds the owner token and a testnet key, so a compromised agent process could bypass SpendGuard. It is a demo, not a security boundary. |
| Medium | The failed-login lockout is keyed by client IP, so behind a shared proxy one bad client can lock out the owner. |
| Low | Re-verification of stuck SUBMITTED requests can starve newer ones. |
| Low | A transaction is matched to a request by signer, recipient, amount and time, so an identical earlier transfer could be reported as the payment. Only the owner can report. |
| Low | The daily budget day follows approval time, not payment time. |
| Low | The `SUBMITTED_TIMEOUT_MS` setting is parsed but not used. |
| Low | The owner token is only checked for length and variety. Use 32 random bytes. |

## Checked and correct

Signer, receiver, amount and single-Transfer-action matching; failed and partial receipt handling; hash uniqueness; exact BigInt money arithmetic; the evaluate transaction and idempotency; the approve re-check; per-agent isolation and API-key hashing; request validation and the redacting logger; no unsafe HTML in the dashboard and no token persistence; agent-demo exactly-once logic and redaction.
