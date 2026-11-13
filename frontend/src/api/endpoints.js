// One function per EXISTING backend route (backend/src/routes/*). Nothing here
// calls a path the backend does not define. Each function returns UI models.
//
//   GET    /api/health                                  public
//   GET    /api/agents                                  owner
//   POST   /api/agents                                  owner  -> { agent, apiKey } (key shown once)
//   GET    /api/agents/:agentId                         owner
//   PUT    /api/agents/:agentId/limits                  owner
//   POST   /api/agents/:agentId/pause | resume          owner
//   POST   /api/agents/:agentId/rotate-key              owner  -> { agent, apiKey } (key shown once)
//   GET    /api/agents/:agentId/recipients?list=        owner
//   PUT    /api/agents/:agentId/recipients/:accountId   owner
//   DELETE /api/agents/:agentId/recipients/:accountId   owner
//   GET    /api/payments?agentId&status&limit           owner
//   GET    /api/payments/:requestId                     owner  -> { payment, approval }
//   POST   /api/payments/:requestId/approve | reject    owner
//   POST   /api/payments/:requestId/tx-report           owner  { txHash, signerId } -> { verdict, action, reason, payment }
//   GET    /api/audit?afterSeq&limit&event&entityId     owner
//   GET    /api/audit/verify                            owner
//
// Not used by this app yet: POST /api/payments/:id/cancel, GET /api/audit/head,
// and the agent-key routes under /api/v1 (those are for agents, not the owner).

import { ApiError } from './errors.js';
import {
  expectArray,
  mapAgent,
  mapApproval,
  mapAuditEntry,
  mapKeyIssue,
  mapPayment,
  mapRecipient,
  mapVerification,
} from './mappers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_RE = /^[a-z0-9._-]{2,64}$/;

export const MAX_PAYMENTS_LIMIT = 200;
export const MAX_AUDIT_LIMIT = 500;

function uuid(name, value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new ApiError('config', `${name} is not valid.`);
  return value;
}

function account(value) {
  if (typeof value !== 'string' || !ACCOUNT_RE.test(value)) throw new ApiError('config', 'The account ID is not valid.');
  return encodeURIComponent(value);
}

function present(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null));
}

export function createEndpoints(client) {
  const call = (method, path, extra = {}) => client.request({ method, path, ...extra });

  return Object.freeze({
    /** Public. Resolves when the backend and its database answer. */
    async health() {
      const data = await call('GET', '/api/health', { auth: 'none' });
      if (data?.status !== 'ok') throw new ApiError('shape', 'Unexpected health response.');
      return true;
    },

    async listAgents() {
      const data = await call('GET', '/api/agents');
      return expectArray(data?.agents, 'agent list').map(mapAgent);
    },

    async createAgent({ name, sourceAccount, dailyBudget, perTxLimit, approvalThreshold }) {
      const data = await call('POST', '/api/agents', {
        body: { name, sourceAccount, dailyBudget, perTxLimit, approvalThreshold },
      });
      return mapKeyIssue(data);
    },

    async updateLimits(agentId, { dailyBudget, perTxLimit, approvalThreshold }) {
      const data = await call('PUT', `/api/agents/${uuid('agentId', agentId)}/limits`, {
        body: { dailyBudget, perTxLimit, approvalThreshold },
      });
      return mapAgent(data?.agent);
    },

    async pauseAgent(agentId) {
      const data = await call('POST', `/api/agents/${uuid('agentId', agentId)}/pause`);
      return mapAgent(data?.agent);
    },

    async resumeAgent(agentId) {
      const data = await call('POST', `/api/agents/${uuid('agentId', agentId)}/resume`);
      return mapAgent(data?.agent);
    },

    async rotateKey(agentId) {
      const data = await call('POST', `/api/agents/${uuid('agentId', agentId)}/rotate-key`);
      return mapKeyIssue(data);
    },

    async listRecipients(agentId, list) {
      const query = list === 'ALLOW' || list === 'BLOCK' ? { list } : undefined;
      const data = await call('GET', `/api/agents/${uuid('agentId', agentId)}/recipients`, { query });
      return expectArray(data?.recipients, 'recipient list').map(mapRecipient);
    },

    async setRecipient(agentId, accountId, { listType, note }) {
      const data = await call('PUT', `/api/agents/${uuid('agentId', agentId)}/recipients/${account(accountId)}`, {
        body: present({ listType, note }),
      });
      return mapRecipient(data?.recipient);
    },

    async removeRecipient(agentId, accountId) {
      const data = await call('DELETE', `/api/agents/${uuid('agentId', agentId)}/recipients/${account(accountId)}`);
      return mapRecipient(data?.recipient);
    },

    async listPayments({ agentId, status, limit = MAX_PAYMENTS_LIMIT } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAYMENTS_LIMIT) {
        throw new ApiError('config', `limit must be 1 to ${MAX_PAYMENTS_LIMIT}.`);
      }
      const data = await call('GET', '/api/payments', { query: { agentId, status, limit } });
      return expectArray(data?.payments, 'payment list').map(mapPayment);
    },

    /** Resolves { payment, approval } where approval may be null. */
    async getPayment(requestId) {
      const data = await call('GET', `/api/payments/${uuid('requestId', requestId)}`);
      const payment = mapPayment(data?.payment);
      const approval = mapApproval(data?.approval);
      return { payment: { ...payment, decisionComment: approval?.comment ?? null }, approval };
    },

    /** Approve. A 409 (policy no longer passes / window passed) throws an ApiError carrying `data`. */
    async approvePayment(requestId, comment) {
      const data = await call('POST', `/api/payments/${uuid('requestId', requestId)}/approve`, {
        body: present({ comment }),
      });
      return { outcome: data?.outcome ?? null, payment: mapPayment(data?.payment) };
    },

    async rejectPayment(requestId, comment) {
      const data = await call('POST', `/api/payments/${uuid('requestId', requestId)}/reject`, {
        body: present({ comment }),
      });
      return { payment: mapPayment(data?.payment) };
    },

    /**
     * Report the NEAR transaction that paid an APPROVED request. The body is exactly { txHash, signerId }.
     * The backend verifies it on-chain and answers 200 with its verdict; the returned payment is the only
     * source of truth for the new status. Reporting the same hash again retries the verification.
     */
    async reportTransaction(requestId, { txHash, signerId }) {
      const data = await call('POST', `/api/payments/${uuid('requestId', requestId)}/tx-report`, {
        body: { txHash, signerId },
      });
      if (typeof data?.verdict !== 'string') throw new ApiError('shape', 'Unexpected transaction report in the backend response.');
      return {
        verdict: data.verdict,
        action: typeof data.action === 'string' ? data.action : null,
        reason: typeof data.reason === 'string' ? data.reason : null,
        payment: mapPayment(data.payment),
      };
    },

    /** Entries come back oldest-first from afterSeq. `head.seq` is the newest sequence number. */
    async listAudit({ afterSeq, limit = 100, event, entityId } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUDIT_LIMIT) {
        throw new ApiError('config', `limit must be 1 to ${MAX_AUDIT_LIMIT}.`);
      }
      const data = await call('GET', '/api/audit', { query: { afterSeq, limit, event, entityId } });
      const headSeq = data?.head?.seq;
      if (!Number.isSafeInteger(headSeq)) throw new ApiError('shape', 'Unexpected audit response.');
      return {
        entries: expectArray(data?.entries, 'audit list').map(mapAuditEntry),
        hasMore: data.hasMore === true,
        nextAfterSeq: Number.isSafeInteger(data.nextAfterSeq) ? data.nextAfterSeq : 0,
        headSeq,
      };
    },

    async verifyAudit() {
      const data = await call('GET', '/api/audit/verify');
      return mapVerification(data?.verification);
    },
  });
}
