// Copy and routes for the marketing landing page (pure data, unit-tested).
// Only describe what SpendGuard AI actually does; no unverifiable claims.

export const LANDING_ROUTE = '/';
// The F2 dashboard Overview page lives at /overview; the landing page is the app root.
export const DASHBOARD_ROUTE = '/overview';

export const HERO = {
  title: 'Secure every payment made by your AI agents.',
  subtitle:
    'SpendGuard AI sits between your agents and your money. Every payment request is checked against your rules, approved by you when needed, and verified on NEAR Testnet.',
  cta: 'Open Live Demo',
};

export const PROBLEMS = [
  {
    title: 'Unauthorized payments',
    body: 'An agent can send funds to a recipient you never approved.',
  },
  {
    title: 'Overspending',
    body: 'Without hard limits, many small payments add up past your budget.',
  },
  {
    title: 'Uncontrolled agents',
    body: 'No single place to see what each agent asked for and what happened.',
  },
];

export const SOLUTIONS = [
  {
    title: 'Deterministic policy engine',
    body: 'The same request always gets the same decision from your written rules.',
  },
  {
    title: 'Spending limits',
    body: 'Set a daily budget and a per-transaction limit for each agent.',
  },
  {
    title: 'Human approval',
    body: 'Payments above your approval threshold wait for you to approve or reject.',
  },
];

export const STEPS = [
  { label: 'Evaluate', body: 'The policy engine checks the request against limits and recipients.' },
  { label: 'Approve', body: 'Requests over your threshold wait for your decision.' },
  { label: 'Sign', body: 'Only an approved payment goes on to be signed.' },
  { label: 'Verify', body: 'The transaction is checked on NEAR Testnet.' },
];

export const SECURITY = [
  {
    title: 'NEAR Testnet transaction verification',
    body: 'A reported transaction is checked against the chain before it is marked verified.',
  },
  {
    title: 'Tamper-evident audit trail',
    body: 'Each audit entry is chained to the one before it, so edits to history are detectable.',
  },
];

export const PREVIEW_NOTE =
  'This preview is the real dashboard running on clearly labelled sample data.';
