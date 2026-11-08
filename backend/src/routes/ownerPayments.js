import { ACCESS } from '../http/routeKit.js';
import {
  approveRequest,
  cancelRequest,
  getApprovalForRequest,
  rejectRequest,
} from '../services/approvals.js';
import { getPaymentRequest, listPaymentRequests } from '../services/payments.js';
import { bodyObject } from './util.js';

const DECISION_FIELDS = ['comment'];

// What the owner sees when an approval cannot go ahead.
const REFUSALS = Object.freeze({
  BLOCKED: {
    code: 'APPROVAL_REFUSED',
    message: 'approval refused: the payment no longer passes the policy',
  },
  EXPIRED: {
    code: 'REQUEST_EXPIRED',
    message: 'the approval window has passed',
  },
});

export function registerOwnerPaymentRoutes(route, { db, config }) {
  const O = ACCESS.OWNER;

  route(
    'GET',
    '/api/payments',
    O,
    ({ query }) => ({ body: { payments: listPaymentRequests(db, query) } }),
    { query: { agentId: 'string', status: 'string', limit: 'int' } },
  );

  route('GET', '/api/payments/:requestId', O, ({ params }) => ({
    body: {
      payment: getPaymentRequest(db, params.requestId),
      approval: getApprovalForRequest(db, params.requestId),
    },
  }));

  route('POST', '/api/payments/:requestId/approve', O, ({ params, body, serviceContext }) => {
    const result = approveRequest(
      db,
      params.requestId,
      bodyObject(body, DECISION_FIELDS),
      serviceContext(),
      config.settings,
    );
    if (result.approved) {
      return {
        body: { outcome: result.outcome, payment: result.request, approval: result.approval },
      };
    }
    return {
      status: 409,
      error: REFUSALS[result.outcome],
      body: {
        outcome: result.outcome,
        refusalReasons: result.refusalReasons,
        payment: result.request,
      },
    };
  });

  route('POST', '/api/payments/:requestId/reject', O, ({ params, body, serviceContext }) => {
    const { request, approval } = rejectRequest(
      db,
      params.requestId,
      bodyObject(body, DECISION_FIELDS),
      serviceContext(),
    );
    return { body: { payment: request, approval } };
  });

  route('POST', '/api/payments/:requestId/cancel', O, ({ params, body, serviceContext }) => {
    bodyObject(body, []); // no fields are accepted
    return { body: { payment: cancelRequest(db, params.requestId, serviceContext()) } };
  });
}
