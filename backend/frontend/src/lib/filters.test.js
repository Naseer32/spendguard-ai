import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAgents, filterAudit, filterRequests, hasActiveFilters, sortRequests } from './filters.js';
import { formatDateTime, relativeTime, utcDay } from './time.js';
import { dailyUsed, dailyUsedPercent } from './budget.js';
import { createDemoState } from '../data/demoSeed.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const demo = createDemoState(NOW);
const byId = Object.fromEntries(demo.agents.map((a) => [a.id, a]));

test('filterAgents filters by status and by case-insensitive query', () => {
  assert.equal(filterAgents(demo.agents, { status: 'PAUSED' }).length, 1);
  assert.equal(filterAgents(demo.agents, { status: 'ACTIVE' }).length, 3);
  assert.equal(filterAgents(demo.agents, { query: 'RESEARCH' }).length, 1);
  assert.equal(filterAgents(demo.agents, { query: 'demo-source-2' })[0].id, 'demo-agent-2');
  assert.equal(filterAgents(demo.agents, { query: 'zzz' }).length, 0);
  assert.equal(filterAgents(demo.agents).length, demo.agents.length);
});

test('filterRequests combines status, agent and text filters', () => {
  const pending = filterRequests(demo.requests, byId, { status: 'APPROVAL_REQUIRED' });
  assert.equal(pending.length, 3);
  assert.ok(pending.every((r) => r.status === 'APPROVAL_REQUIRED'));

  const a1 = filterRequests(demo.requests, byId, { agentId: 'demo-agent-1' });
  assert.ok(a1.every((r) => r.agentId === 'demo-agent-1'));

  const both = filterRequests(demo.requests, byId, { agentId: 'demo-agent-1', status: 'APPROVAL_REQUIRED' });
  assert.equal(both.length, 2);

  assert.equal(filterRequests(demo.requests, byId, { query: 'hardware' }).length, 1);
  assert.equal(filterRequests(demo.requests, byId, { query: 'Subscriptions Agent' }).length > 0, true);
});

test('sortRequests orders by time and by exact amount', () => {
  const newest = sortRequests(demo.requests, 'newest');
  for (let i = 1; i < newest.length; i++) {
    assert.ok(Date.parse(newest[i - 1].createdAt) >= Date.parse(newest[i].createdAt));
  }
  const oldest = sortRequests(demo.requests, 'oldest');
  assert.equal(oldest[0].id, newest[newest.length - 1].id);

  const high = sortRequests(demo.requests, 'amount-desc');
  assert.equal(high[0].amount, '60000000000000000000000000');
  const low = sortRequests(demo.requests, 'amount-asc');
  assert.equal(low[0].amount, '3000000000000000000000000');

  // Numeric, not lexicographic: "9..." must sort below "10..." etc.
  const tricky = sortRequests(
    [
      { id: 'a', amount: '9', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'b', amount: '10', createdAt: '2026-01-01T00:00:00Z' },
    ],
    'amount-desc',
  );
  assert.deepEqual(tricky.map((r) => r.id), ['b', 'a']);
});

test('sorting does not mutate its input', () => {
  const copy = [...demo.requests];
  sortRequests(demo.requests, 'amount-desc');
  assert.deepEqual(demo.requests, copy);
});

test('filterAudit filters by event and agent and returns newest first', () => {
  const evaluated = filterAudit(demo.audit, { event: 'PAYMENT_EVALUATED' });
  assert.equal(evaluated.length, demo.requests.length);
  const seqs = evaluated.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a));

  const a4 = filterAudit(demo.audit, { agentId: 'demo-agent-4' });
  assert.ok(a4.length > 0 && a4.every((e) => e.agentId === 'demo-agent-4'));
  assert.equal(filterAudit(demo.audit, { query: 'zzzz' }).length, 0);
});

test('hasActiveFilters detects any non-default value', () => {
  const defaults = { query: '', status: 'ALL' };
  assert.ok(!hasActiveFilters({ query: '', status: 'ALL' }, defaults));
  assert.ok(hasActiveFilters({ query: 'x', status: 'ALL' }, defaults));
  assert.ok(hasActiveFilters({ query: '', status: 'BLOCKED' }, defaults));
});

test('time helpers handle valid and invalid timestamps', () => {
  assert.equal(formatDateTime('not a date'), '—');
  assert.equal(formatDateTime(undefined), '—');
  assert.equal(formatDateTime('2026-11-10T14:05:00Z', 'utc'), '10 Nov 2026, 14:05 UTC');
  assert.equal(relativeTime('2026-11-10T11:55:00Z', NOW), '5 min ago');
  assert.equal(relativeTime('2026-11-10T09:00:00Z', NOW), '3 h ago');
  assert.equal(relativeTime('2026-11-08T12:00:00Z', NOW), '2 d ago');
  assert.equal(relativeTime('2026-11-10T11:59:50Z', NOW), 'just now');
  assert.equal(relativeTime('2026-11-10T13:00:00Z', NOW), 'just now'); // future clamps
  assert.equal(utcDay('2026-11-10T23:59:59Z'), '2026-11-10');
  assert.equal(utcDay('bad'), null);
});

test('dailyUsed counts only budget-holding statuses created on the UTC day', () => {
  // Use a fixed noon "now" so offsets of a few hours stay on the same UTC day.
  const nowIso = new Date(NOW).toISOString();
  const a2 = dailyUsed(demo.requests, 'demo-agent-2', nowIso);
  // Agent 2 today: req 04 (9, EXECUTED) + req 10 (3, EXECUTED); blocked/approval ones excluded.
  assert.equal(a2, '12000000000000000000000000');
  const a1 = dailyUsed(demo.requests, 'demo-agent-1', nowIso);
  assert.equal(a1, '12500000000000000000000000'); // only req 01 (APPROVED)
  assert.equal(dailyUsedPercent(demo.requests, byId['demo-agent-2'], nowIso), 30);
});
