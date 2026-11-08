// Test helpers for owner route tests. Not imported by production code.

import { nearToYocto as N } from '../money/yocto.js';
import { createAgent } from '../services/agents.js';
import { setRecipient } from '../services/recipients.js';
import { OWNER_TOKEN, startTestServer } from './httpKit.js';
import { agentInput, svc } from './serviceKit.js';
import { HIGH_FAILURE_LIMIT } from './testRoutes.js';

export const START = Date.UTC(2026, 10, 4, 12, 0, 0, 0); // 2026-11-04T12:00:00.000Z
export const DAY = '2026-11-04';
export const HOUR = 3_600_000;

export function makeClock(start = START) {
  let current = start;
  return {
    now: () => current,
    set(value) { current = value; },
    advance(ms) { current += ms; },
  };
}

let counter = 0;
export function nextKey() {
  counter += 1;
  return `owner-test-key-${counter}`;
}

// Starts a server with a controllable clock, one agent and its allowlist, runs
// fn(context), and always closes the server.
//   owner(method, path, json)   an owner-authenticated request
//   evaluate(over)              the agent evaluates a payment; returns the agent's view
//   agentView(id)               the agent reads one of its payments
export async function withServer(fn, agentOver = {}, allowed = ['merchant.testnet']) {
  const clock = makeClock();
  const t = await startTestServer({ now: clock.now, env: HIGH_FAILURE_LIMIT });
  try {
    const { agent, apiKey } = createAgent(t.db, agentInput({ name: 'Agent', ...agentOver }), svc());
    for (const accountId of allowed) {
      setRecipient(t.db, agent.id, { accountId, listType: 'ALLOW' }, svc());
    }
    const owner = (method, path, json) => t.request(method, path, { token: OWNER_TOKEN, json });
    const evaluate = async (over = {}) => {
      const res = await t.request('POST', '/api/v1/payments/evaluate', {
        token: apiKey,
        json: { idempotencyKey: nextKey(), recipient: 'merchant.testnet', amount: N('1'), ...over },
      });
      if (res.status !== 201) {
        throw new Error(`evaluate failed with ${res.status}: ${res.text}`);
      }
      return res.json.data.payment;
    };
    const agentView = (id) => t.request('GET', `/api/v1/payments/${id}`, { token: apiKey });
    return await fn({ t, clock, agent, apiKey, owner, evaluate, agentView });
  } finally {
    await t.close();
  }
}
