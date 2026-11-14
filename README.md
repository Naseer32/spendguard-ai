# SpendGuard AI

A spending-limit and approval layer for AI agents that move money on NEAR. An agent asks SpendGuard before every payment. A deterministic policy engine answers APPROVED, BLOCKED or APPROVAL_REQUIRED, and a payment only counts as executed after the backend has verified its transaction on NEAR Testnet.

Built for **NEAR HACKATHON**, track: **AI Security & Defense** (make AI-controlled money safer with spending limits, wallet safeguards and scam detection).

## The problem

An autonomous agent that holds a key can pay anyone, any amount, as often as it likes. One bad prompt or one bug can drain the wallet.

## What SpendGuard does

- **Policy engine.** Per-agent daily budget, per-transaction limit, approval threshold, recipient allowlist and blocklist, and an owner pause switch. The engine is pure code: no AI, no clock, no randomness, and bad input fails closed to BLOCKED.
- **Human approval.** Unknown recipients and large payments wait for the owner in the dashboard.
- **On-chain verification.** After a payment is sent, the backend checks the transaction over NEAR RPC: right signer, right recipient, exactly the approved amount, success at final finality. Only then is the request marked executed. A mismatch is flagged, not hidden.
- **Exact money math.** Amounts are yoctoNEAR strings handled with BigInt. No floating point anywhere.
- **Tamper-evident audit log.** Every decision and state change is appended to a hash-chained log that the dashboard can verify.

AI never changes a decision. The decision comes from the rules; any AI text would only explain it (see Status).

## NEAR tools used

- NEAR Testnet RPC (transaction verification in the backend, sending in the agent demo)
- `near-api-js` (the autonomous agent demo signs and sends transfers)
- NEAR Wallet Selector with Meteor Wallet (owner signing in the dashboard)

No other NEAR products are used. In particular, this project does not use NEAR Intents, Chain Signatures or NEAR AI Cloud.

## Architecture

```
Agent -> POST /api/v1/payments/evaluate (agent API key)
              |
              v
        Express API -> Policy engine (pure) -> decision + reason codes
              |
              +-> SQLite (node:sqlite), hash-chained audit log
              +-> Owner dashboard (React): approve, reject, pause, limits, audit
Agent / owner signs the NEAR Testnet transfer
              |
              v
        POST /api/payments/:id/tx-report -> backend verifies the hash via NEAR RPC
```

More detail in [docs/architecture.md](docs/architecture.md).

## Custody model (read this)

This is a testnet MVP.

- SpendGuard evaluates and verifies. It never stores private keys or seed phrases.
- In the **dashboard flow** the owner signs in their own browser wallet.
- In the **agent demo** (`agent-demo/`) the agent process holds a testnet key and signs for itself. SpendGuard still decides first and verifies afterwards, but it does not hold that key.
- In both modes SpendGuard cannot physically stop a key holder from sending other transfers. It detects and flags transactions that do not match an authorization. A restricted vault contract that enforces limits on-chain is future work.
- The tx-report endpoint is owner-only, so the agent demo also needs the owner token. Anyone holding it can also approve held payments, so do not hand it to an untrusted agent in a real deployment.

## Try it

Requires Node.js 24.15 or newer. These steps take about 10 minutes and use only testnet funds.

### 1. See the dashboard (2 minutes, no setup)

```
cd frontend
npm install
npm run dev
```

| Do | See |
|---|---|
| Open http://localhost:5173 | The landing page. Choose **Open Live Demo**. |
| Open **Agents**, then an agent | Its limits, status and recipient lists, from clearly labelled demo data. |
| Open **Approvals**, approve one request | The request moves to APPROVED and the budget updates. |
| Open **Activity** | The audit trail for what you just did. |
| Choose **Connect wallet** (NEAR Testnet), then **Agents > New agent** | The source account is filled in from your connected wallet and locked. Disconnect the wallet to type a different account. |

### 2. Run the backend

```
cd backend
npm install
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # use as OWNER_TOKEN
cp .env.example .env     # set OWNER_TOKEN=<that value>
npm start
```

| Do | See |
|---|---|
| `curl localhost:3000/api/health` | `{"data":{"status":"ok"}}` |

In the dashboard open **Settings > Backend connection**, leave the address empty, enter the owner token. The dashboard now shows live data instead of the demo seed.

### 3. Run the autonomous agent on NEAR Testnet

You need a funded testnet account and its secret key. Use a throwaway account.

1. In the dashboard create an agent with your testnet account as its source account and copy the API key (shown once).
2. Allowlist the recipient for that agent.
3. Follow [agent-demo/README.md](agent-demo/README.md) to fill in `agent-demo/.env`, then:

```
cd agent-demo
npm install
npm start -- send 0.1 <recipient>.testnet "coffee money"
```

| Do | See |
|---|---|
| Send 0.1 NEAR to an allowlisted recipient within limits | `Decision: APPROVED`, a transaction hash, then `Backend verdict: VERIFIED` and the backend's own status |
| Send to a recipient that is not allowlisted | `Decision: APPROVAL_REQUIRED`, reason `RECIPIENT_NOT_ALLOWLISTED`, "No money was sent" |
| Send more than the per-transaction limit | `Decision: BLOCKED`, reason `EXCEEDS_TX_LIMIT`, "No money was sent" |
| Run the exact same command again | "Already sent and reported", nothing is sent twice |

### Live run

These transfers were made on NEAR Testnet by the agent demo, each approved by the backend and then verified on-chain:

- `56PbAUYYcJ6vwiNqUyNhK1fMmu9HA49kwkftps4n6kHd` (0.1 NEAR)
- `5VqZsDeHxXrpszVhsLiGuML525gteUdjQRCfGtWBVutj` (1 NEAR, within that agent's limits)

Look them up on a NEAR Testnet explorer. A 6 NEAR request above the 5 NEAR per-transaction limit was BLOCKED and nothing was sent.

## Tests

```
cd backend && npm test
cd frontend && npm test
cd agent-demo && npm test
```

Backend and frontend tests also run on every push through GitHub Actions on Node 24.

## Status

| Stage | Scope | State |
|---|---|---|
| 1 | Policy engine, money math, lifecycle state machine, CI | Complete |
| 2 | Database, reservations, audit chain, API | Complete |
| 3 | NEAR RPC client, transaction verifier, tx-report endpoint, re-check of stuck submissions | Complete |
| 4 | Owner dashboard (demo mode and live mode) with wallet signing | Built, still being polished |
| 5 | Autonomous agent demo (`agent-demo/`) | Complete, tested live on Testnet |
| 6 | AI explainer | Planned. Decisions do not depend on it. |

## Known limitations

- Testnet only. Mainnet is refused by the backend and the agent demo.
- Native NEAR transfers only. No fungible tokens.
- No AI explainer yet; explanations are not generated.
- Single owner token. No multi-user accounts.
- See "Custody model" for what SpendGuard cannot prevent.

## Project layout

```
backend/     Node API, policy engine, SQLite, NEAR verifier
frontend/    React + Vite + Tailwind owner dashboard
agent-demo/  Autonomous agent that pays only when SpendGuard approves
docs/        Architecture
```

## License

MIT. See [LICENSE](LICENSE).
