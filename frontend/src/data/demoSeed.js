// DEMO DATA ONLY.
//
// Everything created here is an invented sample used to make the dashboard
// usable before the backend is connected. None of it comes from the SpendGuard
// backend or from NEAR Testnet.
//
// - Account IDs use the reserved-looking ".example" suffix and say "demo".
// - There are deliberately NO transaction hashes, API keys or key material.
// - EXECUTED here only means "labelled executed in the demo"; nothing was sent.
//
// Timestamps are generated relative to `nowMs` so the sample always looks
// recent. Real data access will replace this module in a later stage.

import { formatNear, nearToYocto } from '../lib/money.js';

const N = (near) => nearToYocto(String(near));

function isoMinutesAgo(nowMs, minutes) {
  return new Date(nowMs - minutes * 60_000).toISOString();
}

const AGENT_DEFS = [
  { id: 'demo-agent-1', name: 'Demo Procurement Agent', status: 'ACTIVE', source: 'demo-source-1.example', daily: 100, tx: 50, threshold: 20, createdMin: 7200 },
  { id: 'demo-agent-2', name: 'Demo Subscriptions Agent', status: 'ACTIVE', source: 'demo-source-2.example', daily: 40, tx: 15, threshold: 10, createdMin: 6800 },
  { id: 'demo-agent-3', name: 'Demo Research Agent', status: 'ACTIVE', source: 'demo-source-3.example', daily: 25, tx: 10, threshold: 5, createdMin: 6000 },
  { id: 'demo-agent-4', name: 'Demo Payroll Agent', status: 'PAUSED', source: 'demo-source-4.example', daily: 200, tx: 100, threshold: 50, createdMin: 5400 },
];

const RECIPIENT_DEFS = [
  { agent: 'demo-agent-1', account: 'demo-recipient-a.example', list: 'ALLOW', note: 'Demo cloud vendor' },
  { agent: 'demo-agent-1', account: 'demo-recipient-b.example', list: 'ALLOW', note: 'Demo supplier' },
  { agent: 'demo-agent-1', account: 'demo-recipient-c.example', list: 'BLOCK', note: 'Demo blocked account' },
  { agent: 'demo-agent-2', account: 'demo-recipient-d.example', list: 'ALLOW', note: 'Demo SaaS subscription' },
  { agent: 'demo-agent-3', account: 'demo-recipient-f.example', list: 'ALLOW', note: 'Demo data provider' },
  { agent: 'demo-agent-4', account: 'demo-recipient-g.example', list: 'ALLOW', note: null },
];

const REQUEST_DEFS = [
  { n: 1, agent: 'demo-agent-1', to: 'demo-recipient-a.example', amt: 12.5, status: 'APPROVED', decision: 'APPROVED', reasons: ['WITHIN_POLICY'], min: 25, purpose: 'Demo: cloud credits' },
  { n: 2, agent: 'demo-agent-1', to: 'demo-recipient-b.example', amt: 35, status: 'APPROVAL_REQUIRED', decision: 'APPROVAL_REQUIRED', reasons: ['ABOVE_APPROVAL_THRESHOLD'], min: 60, purpose: 'Demo: supplier invoice' },
  { n: 3, agent: 'demo-agent-1', to: 'demo-recipient-c.example', amt: 8, status: 'BLOCKED', decision: 'BLOCKED', reasons: ['RECIPIENT_BLOCKED'], min: 95, purpose: 'Demo: unknown vendor' },
  { n: 4, agent: 'demo-agent-2', to: 'demo-recipient-d.example', amt: 9, status: 'EXECUTED', decision: 'APPROVED', reasons: ['WITHIN_POLICY'], min: 180, purpose: 'Demo: monthly subscription' },
  { n: 5, agent: 'demo-agent-2', to: 'demo-unknown-e.example', amt: 6, status: 'APPROVAL_REQUIRED', decision: 'APPROVAL_REQUIRED', reasons: ['RECIPIENT_NOT_ALLOWLISTED'], min: 40, purpose: 'Demo: new tool trial' },
  { n: 6, agent: 'demo-agent-3', to: 'demo-recipient-f.example', amt: 30, status: 'BLOCKED', decision: 'BLOCKED', reasons: ['EXCEEDS_TX_LIMIT'], min: 130, purpose: 'Demo: dataset purchase' },
  { n: 7, agent: 'demo-agent-3', to: 'demo-recipient-f.example', amt: 4, status: 'SUBMITTED', decision: 'APPROVED', reasons: ['WITHIN_POLICY'], min: 15, purpose: 'Demo: API usage' },
  { n: 8, agent: 'demo-agent-4', to: 'demo-recipient-g.example', amt: 60, status: 'BLOCKED', decision: 'BLOCKED', reasons: ['AGENT_PAUSED'], min: 300, purpose: 'Demo: payroll batch' },
  { n: 9, agent: 'demo-agent-1', to: 'demo-recipient-a.example', amt: 22, status: 'APPROVAL_REQUIRED', decision: 'APPROVAL_REQUIRED', reasons: ['ABOVE_APPROVAL_THRESHOLD'], min: 10, purpose: 'Demo: hardware order' },
  { n: 10, agent: 'demo-agent-2', to: 'demo-recipient-d.example', amt: 3, status: 'EXECUTED', decision: 'APPROVED', reasons: ['WITHIN_POLICY'], min: 400, purpose: 'Demo: add-on' },
  { n: 11, agent: 'demo-agent-3', to: 'demo-unknown-h.example', amt: 7, status: 'REJECTED', decision: 'APPROVAL_REQUIRED', reasons: ['RECIPIENT_NOT_ALLOWLISTED'], min: 500, purpose: 'Demo: unfamiliar recipient', decidedMin: 480, comment: 'Demo: not a known vendor.' },
  { n: 12, agent: 'demo-agent-1', to: 'demo-recipient-b.example', amt: 45, status: 'EXPIRED', decision: 'APPROVAL_REQUIRED', reasons: ['ABOVE_APPROVAL_THRESHOLD'], min: 1500, purpose: 'Demo: stale request', decidedMin: 1440 },
  { n: 13, agent: 'demo-agent-2', to: 'demo-recipient-d.example', amt: 18, status: 'BLOCKED', decision: 'BLOCKED', reasons: ['EXCEEDS_TX_LIMIT'], min: 220, purpose: 'Demo: annual plan' },
];

export function createDemoState(nowMs = Date.now()) {
  const agents = AGENT_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    sourceAccount: d.source,
    dailyBudget: N(d.daily),
    perTxLimit: N(d.tx),
    approvalThreshold: N(d.threshold),
    createdAt: isoMinutesAgo(nowMs, d.createdMin),
    updatedAt: isoMinutesAgo(nowMs, d.createdMin),
  }));
  const agentName = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  const recipients = RECIPIENT_DEFS.map((d, i) => ({
    id: `demo-recipient-row-${i + 1}`,
    agentId: d.agent,
    accountId: d.account,
    listType: d.list,
    note: d.note,
    createdAt: isoMinutesAgo(nowMs, 6500 - i * 100),
  }));

  const requests = REQUEST_DEFS.map((d) => ({
    id: `demo-req-${String(d.n).padStart(2, '0')}`,
    agentId: d.agent,
    recipient: d.to,
    amount: N(d.amt),
    purpose: d.purpose,
    decision: d.decision,
    status: d.status,
    reasonCodes: d.reasons,
    createdAt: isoMinutesAgo(nowMs, d.min),
    decidedAt: d.decidedMin ? isoMinutesAgo(nowMs, d.decidedMin) : null,
    decisionComment: d.comment ?? null,
  }));

  const draft = [];
  for (const a of agents) {
    draft.push({ ts: a.createdAt, actor: 'demo-owner', event: 'AGENT_CREATED', entityId: a.id, agentId: a.id, summary: `${a.name} was created.` });
  }
  for (const r of recipients) {
    draft.push({ ts: r.createdAt, actor: 'demo-owner', event: 'RECIPIENT_ADDED', entityId: r.accountId, agentId: r.agentId, summary: `${r.accountId} added to the ${r.listType === 'ALLOW' ? 'allow' : 'block'} list of ${agentName[r.agentId]}.` });
  }
  draft.push({ ts: isoMinutesAgo(nowMs, 5000), actor: 'demo-owner', event: 'AGENT_PAUSED', entityId: 'demo-agent-4', agentId: 'demo-agent-4', summary: `${agentName['demo-agent-4']} was paused.` });
  for (const r of requests) {
    draft.push({ ts: r.createdAt, actor: 'demo-engine', event: 'PAYMENT_EVALUATED', entityId: r.id, agentId: r.agentId, summary: `${agentName[r.agentId]}: ${formatNear(r.amount)} NEAR to ${r.recipient} evaluated as ${r.decision}.` });
    if (r.status === 'REJECTED') {
      draft.push({ ts: r.decidedAt, actor: 'demo-owner', event: 'PAYMENT_REJECTED', entityId: r.id, agentId: r.agentId, summary: `Request ${r.id} was rejected.` });
    }
  }
  draft.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const audit = draft.map((e, i) => ({ seq: i + 1, ...e }));

  return { agents, recipients, requests, audit };
}
