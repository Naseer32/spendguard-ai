# AMANA Guard agent demo (NEAR Testnet)

A small script that plays an autonomous AI agent: you give it a payment command, it asks AMANA Guard first, and it only moves money if AMANA Guard says APPROVED.

```
node agent.js send 0.1 sickzone9097.testnet "coffee money"
```

## Read this first

- **Testnet demo only.** It refuses to run unless the network, RPC and accounts are NEAR testnet.
- **The agent holds a testnet key.** `SOURCE_PRIVATE_KEY` lives in this script's environment. AMANA Guard evaluates the request and verifies the transaction afterwards, but in this mode it does **not** custody that key and cannot physically stop the key from sending other transfers. It can only detect and flag transactions that do not match an authorization.
- **The dashboard's browser-wallet flow is a separate path.** There the owner signs in their own wallet. This script is the agent-signs-itself path.
- **The report step needs the owner token.** The backend's `tx-report` endpoint is owner-only; the agent API key cannot call it. So this script needs `OWNER_TOKEN` as well. The script only uses it for that one call, plus a read of the agent's limits, but anyone who holds the owner token can also approve held payments in the backend. For a real deployment, do not give the agent process the owner token: let the owner (or a separate reporter process) report the hash. For the demo, run it on your own machine.

## What it does

1. Sends `POST /api/v1/payments/evaluate` with the agent API key and `{ idempotencyKey, recipient, amount, purpose }`. `amount` is a yoctoNEAR string.
2. If the backend answers APPROVED (both decision and status), it signs and sends exactly that amount to exactly that recipient from `SOURCE_ACCOUNT`.
3. It sends `POST /api/payments/:requestId/tx-report` with `{ txHash, signerId }`. The backend verifies the transaction on-chain.
4. It prints the backend's verdict and the request status exactly as returned. The script never decides or invents a final status itself.

If the decision is APPROVAL_REQUIRED or BLOCKED, it prints the reason codes and stops. It never sends money in those cases.

## Setup

Requires Node 24.15 or newer and a running AMANA Guard backend (see `../backend`).

```
cd agent-demo
npm install
cp .env.example .env     # then edit .env: placeholders only in the example
```

Secrets are read from environment variables only. They are never accepted as command-line arguments, never written to disk, and redacted from all output.

| Variable | Purpose |
|---|---|
| `BACKEND_URL` | AMANA Guard backend, for example `http://127.0.0.1:3000` |
| `AGENT_API_KEY` | The agent's API key (`sgk_...`) |
| `OWNER_TOKEN` | Backend owner token, used for the tx-report call (see warning above) |
| `SOURCE_ACCOUNT` | The agent's NEAR testnet account. Must equal the agent's source account in AMANA Guard |
| `SOURCE_PRIVATE_KEY` | Testnet secret key for that account (`ed25519:...`) |
| `NEAR_NETWORK`, `NEAR_RPC_URL` | Optional. Anything other than testnet is refused |
| `PAYMENT_SALT` | Optional. Change it to deliberately make a new payment with an identical command |
| `AGENT_STATE_FILE` | Optional. Default `~/.spendguard-agent-demo/state.json` |

Run with the env file loaded: `npm start -- send 0.1 sickzone9097.testnet "coffee money"` (the `start` script loads `.env`).

## Try it (do X, see Y)

Prepare: in the dashboard create an agent whose source account is your testnet account, copy its API key once, and allowlist `sickzone9097.testnet` for it.

| Do | See |
|---|---|
| `send 0.1 <allowlisted recipient>` with limits above 0.1 NEAR | `Decision: APPROVED`, a transaction hash, then `Backend verdict: VERIFIED` and the backend's status |
| `send 0.1 <recipient not on the allowlist>` | `Decision: APPROVAL_REQUIRED`, reason `RECIPIENT_NOT_ALLOWLISTED`, "No money was sent" |
| `send 1000 <recipient>` above the per-transaction limit | `Decision: BLOCKED`, reason `EXCEEDS_TX_LIMIT`, "No money was sent" |
| Pause the agent in the dashboard, then send | `Decision: BLOCKED`, reason `AGENT_PAUSED` |
| Run the exact same command again after a success | "already sent and reported", nothing is sent |
| Unplug the network right after a send, then re-run | "Retrying the report only", the same hash is reported, no second transfer |

Exit codes: `0` verified by the backend, `1` error or backend refusal, `2` not approved (nothing sent), `3` sent but the backend has not settled it yet (re-run to retry the report).

## Exactly-once

- The idempotency key is derived from the command (source account, recipient, exact yocto amount, purpose, optional salt), so the same command always maps to the same AMANA Guard request.
- Before sending, the script records an intent in the local state file; right after sending it records the transaction hash. On a re-run it only retries the report for an already-sent transaction. If a previous run crashed after starting a send but before recording a hash, it refuses to send again and tells you to check the account history.
- The state file holds only public data (hash, accounts, request id) and lives outside the repository.
- NEAR amounts are converted to yocto with exact integer math, no floating point.
- The amount-versus-limit check before sending is a convenience only. The backend decision is the authority.

## Tests

```
npm test
```

Covers NEAR-to-yocto conversion, refusing to send unless APPROVED, refusing a second send for the same key, secret redaction and testnet-only enforcement. The network and the NEAR signer are mocked.
