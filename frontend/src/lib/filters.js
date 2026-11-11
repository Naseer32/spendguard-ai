// Pure list filtering and sorting for the Agents, Payment Requests and Audit
// pages. No React, so it can be unit tested directly.

import { compareYocto } from './money.js';

function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

function includesAny(query, fields) {
  const q = norm(query);
  if (q === '') return true;
  return fields.some((f) => norm(f).includes(q));
}

export function filterAgents(agents, { query = '', status = 'ALL' } = {}) {
  return agents.filter(
    (a) =>
      (status === 'ALL' || a.status === status) &&
      includesAny(query, [a.name, a.id, a.sourceAccount]),
  );
}

export const REQUEST_SORTS = Object.freeze([
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'amount-desc', label: 'Amount: high to low' },
  { id: 'amount-asc', label: 'Amount: low to high' },
]);

export function sortRequests(requests, sort = 'newest') {
  const list = [...requests];
  const byTime = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt);
  switch (sort) {
    case 'oldest':
      return list.sort(byTime);
    case 'amount-desc':
      return list.sort((a, b) => compareYocto(b.amount, a.amount) || byTime(b, a));
    case 'amount-asc':
      return list.sort((a, b) => compareYocto(a.amount, b.amount) || byTime(b, a));
    default:
      return list.sort((a, b) => byTime(b, a));
  }
}

export function filterRequests(
  requests,
  agentsById = {},
  { query = '', status = 'ALL', agentId = 'ALL', sort = 'newest' } = {},
) {
  const filtered = requests.filter(
    (r) =>
      (status === 'ALL' || r.status === status) &&
      (agentId === 'ALL' || r.agentId === agentId) &&
      includesAny(query, [r.id, r.recipient, r.purpose, agentsById[r.agentId]?.name]),
  );
  return sortRequests(filtered, sort);
}

export function filterAudit(
  events,
  { query = '', event = 'ALL', agentId = 'ALL' } = {},
) {
  return events
    .filter(
      (e) =>
        (event === 'ALL' || e.event === event) &&
        (agentId === 'ALL' || e.agentId === agentId) &&
        includesAny(query, [e.summary, e.event, e.actor, e.entityId]),
    )
    .sort((a, b) => b.seq - a.seq);
}

export function hasActiveFilters(filters, defaults) {
  return Object.keys(defaults).some((k) => filters[k] !== defaults[k]);
}
