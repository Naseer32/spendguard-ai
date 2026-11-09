# spendguard-ai

AI-powered security layer for autonomous agents. Enforce spending limits, evaluate payment risks and protect funds on NEAR.

Built for the NEAR Hackathon 2026.

## How it works

An agent sends each payment request to SpendGuard. A deterministic policy engine returns one of three outcomes:

- **APPROVED**: within all limits
- **BLOCKED**: violates a hard rule (paused agent, blocked recipient, per-transaction limit, daily budget)
- **APPROVAL_REQUIRED**: needs a human (unknown recipient, or above the approval threshold)

AI only explains decisions. It can never change them.

## Custody model (MVP)

SpendGuard authorizes payments, and the owner signs the actual NEAR Testnet transaction in their own wallet. SpendGuard never stores private keys or seed phrases. A payment is only marked EXECUTED after its transaction hash is verified on-chain through NEAR RPC.

**Limitation:** in this mode SpendGuard cannot physically prevent an owner from sending other transfers. It detects and flags transactions that do not match an authorization. A restricted vault contract is a possible later improvement.

## Status

| Stage | Scope | State |
|---|---|---|
| 1 | Policy engine, money math, lifecycle state machine, CI | Complete |
| 2 | Database, reservations, audit chain, API | Complete |
| 3a | NEAR RPC configuration, safe RPC client, inspect-tx script, fake-RPC tests, real Testnet transaction inspection | In progress |
| 3b | NEAR transaction verifier and fixture-based tests | Planned |
| 3c | Transaction reporting endpoints and lifecycle transitions | Planned |
| 4 | Mobile-first dashboard and wallet signing | Planned |
| 5 | AI explainer (NEAR AI Cloud) | Planned |
| 6 | Hardening and demo | Planned |

## Requirements

- Node.js 24.15 or newer (uses the built-in `node:sqlite`, no native dependencies)

## Run the tests

```
cd backend
npm test
```

Tests also run on every push through GitHub Actions on Node 24.

## Documentation

See [docs/architecture.md](docs/architecture.md).
