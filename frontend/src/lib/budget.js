// Derived budget figures for display. The backend owns real budget accounting
// (reservations); this only summarises whatever request list the UI was given.

import { BUDGET_HOLDING_STATUSES } from './status.js';
import { percentOf, sumYocto } from './money.js';
import { utcDay } from './time.js';

/** Total yocto held against today's (UTC) budget for one agent. */
export function dailyUsed(requests, agentId, nowIso) {
  const today = utcDay(nowIso);
  return sumYocto(
    requests
      .filter(
        (r) =>
          r.agentId === agentId &&
          BUDGET_HOLDING_STATUSES.includes(r.status) &&
          utcDay(r.createdAt) === today,
      )
      .map((r) => r.amount),
  );
}

export function dailyUsedPercent(requests, agent, nowIso) {
  return percentOf(dailyUsed(requests, agent.id, nowIso), agent.dailyBudget);
}
