import { RateLimitError } from '../http/httpErrors.js';
import { ACCESS } from '../http/routeKit.js';
import { evaluatePaymentRequest, getAgentPaymentRequest } from '../services/payments.js';
import { bodyObject, toAgentPaymentView } from './util.js';

const EVALUATE_FIELDS = ['idempotencyKey', 'recipient', 'amount', 'purpose'];

export function registerAgentRoutes(route, { db, config, limits }) {
  // The agent is always the authenticated one; the body cannot name an agent.
  route('POST', '/api/v1/payments/evaluate', ACCESS.AGENT, ({ body, principal, serviceContext }) => {
    const state = limits.evaluate.hit(principal.agentId);
    if (!state.allowed) {
      throw new RateLimitError(state.retryAfterSeconds);
    }
    const input = bodyObject(body, EVALUATE_FIELDS);
    const { request, replayed } = evaluatePaymentRequest(
      db,
      principal.agentId,
      input,
      serviceContext(),
      config.settings,
    );
    return {
      status: replayed ? 200 : 201,
      body: { payment: toAgentPaymentView(request), replayed },
    };
  });

  route('GET', '/api/v1/payments/:requestId', ACCESS.AGENT, ({ params, principal }) => ({
    body: {
      payment: toAgentPaymentView(getAgentPaymentRequest(db, principal.agentId, params.requestId)),
    },
  }));
}
