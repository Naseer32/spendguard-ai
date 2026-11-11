# SpendGuard AI frontend

React + Vite + Tailwind CSS (v4) owner dashboard.

**Status:** all six sections are built: Overview, Agents (list + detail), Payment
Requests, Approvals, Activity & Audit, and Settings. Everything runs on clearly
labelled **demo data** held in memory. There is no backend connection, no wallet
connection and no payment signing. Reloading the page restores the sample data.

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
  state/                   DemoStore (the seam to replace with the real backend),
                           reducer (pure), Settings (display prefs), Toasts
  data/demoSeed.js         DEMO DATA ONLY
  lib/                     money (BigInt yocto), validation, filters, status,
                           reasons, time, budget: pure, unit-tested logic
```

## Connecting the backend later

Pages read and change data only through `useDemoStore()`. Replace
`state/DemoStore.jsx` (and drop `data/demoSeed.js`) with API-backed
equivalents; the pages, filters and modals stay as they are. Client-side form
validation mirrors the backend rules for fast feedback only; the backend is the
source of truth. Money is always a yoctoNEAR string handled with BigInt.

## Rules

- Never put API keys, private keys or seed phrases in this app or in `VITE_*`
  variables (they are public in the browser bundle).
- Never display transaction hashes unless verified by the backend.
- Demo data must stay labelled as demo and must never look like real chain data
  (a test enforces this).
