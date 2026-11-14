# AMANA Guard frontend

React + Vite + Tailwind CSS (v4) owner dashboard.

**Status:** all six sections are built. The app starts in **demo mode** (clearly
labelled sample data held in memory, nothing leaves the browser). In
**Settings > Backend connection** you can connect it to the AMANA Guard backend's
existing `/api` routes and see live data. There is no wallet connection and no
payment signing: approving a payment records your decision only.

## Run

Requires Node.js 20.19 or newer (the repo's backend already requires 24.15+).

```
cd frontend
npm install
npm run dev       # http://localhost:5173 (also reachable on your LAN for phone testing)
npm run build     # production build into frontend/dist
npm run preview   # serve the production build
npm test          # unit tests (Node's built-in runner, no extra dependencies)
```

## Structure

```
src/
  main.jsx, App.jsx        entry, providers and routes
  index.css                Tailwind import + design tokens (@theme)
  layout/                  AppLayout, Sidebar (desktop), MobileNav (phone), Header,
                           NetworkStatus + WalletButton (reserved, not wired)
  pages/                   Overview, Agents, AgentDetail, PaymentRequests,
                           Approvals, Activity, Settings
  components/              Domain modals: AgentForms, RecipientModal,
                           RequestDetailModal, DecisionModal, ReasonList
  components/ui/           Card, StatCard, PageContainer, StatusBadge, Button, Field,
                           Filters, DataList (table on desktop, cards on phone),
                           Modal (native <dialog>), ConfirmDialog, StateViews,
                           ViewBoundary (loading/error/empty/no-match), Display, Icons
  api/                     HTTP client, endpoint wrappers, mappers (live mode)
  state/                   DataStore (demo + live), loaders, reducer (demo, pure),
                           Settings (display prefs), Toasts
  data/demoSeed.js         DEMO DATA ONLY
  lib/                     money (BigInt yocto), validation, filters, status,
                           reasons, time, budget: pure, unit-tested logic
```

## Connecting to the backend

Run the backend (see `backend/`), then either:

1. **Dev proxy (no CORS setup):** `npm run dev`, leave **Backend address** empty in
   Settings, enter the owner token. Vite forwards `/api` to
   `VITE_API_PROXY_TARGET` (default `http://127.0.0.1:3000`).
2. **Direct:** enter the backend address (e.g. `http://192.168.1.20:3000`) and the
   token. The backend must list this page's origin in `CORS_ORIGINS`. Plain
   `http://` is accepted only for localhost and private networks; use `https://`
   anywhere else.

The owner token is the backend's `OWNER_TOKEN`. It is typed into a password field,
held **in memory only** (never in storage, the URL, logs or error messages), sent only
as `Authorization: Bearer`, and dropped on Disconnect, on a rejected token, or on page
reload. Requests use `credentials: 'omit'` and never follow redirects. A page reload
always returns to demo mode.

Agent API keys come back from the backend exactly once, on create and rotate. They are
shown in a dialog that cannot be dismissed by accident and are never stored.

### Where the code is

- `src/api/`: `client.js` (the only place that calls `fetch`), `endpoints.js` (one
  function per existing route; header comment lists them), `mappers.js` (validates
  response shapes, drops fields the UI does not need), `errors.js`, `baseUrl.js`.
- `src/state/DataStore.jsx`: `useStore()` exposes the same `{ state, agentsById, actions }`
  to every page in both modes, plus `isLive`, `status`, `connection`. All actions are async
  and return `{ ok, error?, field? }`. `loaders.js` holds the pure loading logic.
- `src/data/demoSeed.js` and `state/reducer.js` are demo mode only.

### Gaps (backend capabilities that do not exist yet)

No routes were added or changed. The UI works around these:

- **Budget usage:** no endpoint returns "spent today". The UI estimates it from the 200
  most recent payments and says so.
- **Transactions:** no read endpoint for transaction details or on-chain verification, and
  signing is out of scope, so no transaction hash is ever shown.
- **Backend settings** (approval window, etc.) are not exposed, so Settings shows none.
- **Audit by agent:** entries have no agent column; the agent is derived from the payload,
  payment or entity id.
- Not used yet: `POST /api/payments/:id/cancel`, `POST /api/payments/:id/tx-report`,
  `GET /api/audit/head`.

Client-side form validation mirrors the backend rules for fast feedback only; the backend
is the source of truth. Money is always a yoctoNEAR string handled with BigInt.

## Rules

- Never put API keys, private keys or seed phrases in this app or in `VITE_*`
  variables (they are public in the browser bundle).
- Never display transaction hashes unless verified by the backend.
- Network calls live only in `src/api/client.js` (a test enforces this).
- Demo data must stay labelled as demo and must never look like real chain data
  (a test enforces this).
