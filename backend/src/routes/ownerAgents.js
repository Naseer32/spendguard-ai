import { ACCESS } from '../http/routeKit.js';
import {
  createAgent,
  getAgent,
  listAgents,
  pauseAgent,
  resumeAgent,
  rotateApiKey,
  updateLimits,
} from '../services/agents.js';
import { listRecipients, removeRecipient, setRecipient } from '../services/recipients.js';
import { bodyObject } from './util.js';

const CREATE_FIELDS = ['name', 'sourceAccount', 'dailyBudget', 'perTxLimit', 'approvalThreshold'];
const LIMIT_FIELDS = ['dailyBudget', 'perTxLimit', 'approvalThreshold'];
const RECIPIENT_FIELDS = ['listType', 'note'];

export function registerOwnerAgentRoutes(route, { db }) {
  const O = ACCESS.OWNER;

  route('GET', '/api/agents', O, () => ({ body: { agents: listAgents(db) } }));

  // The API key is returned here and by rotate-key only, exactly once.
  route('POST', '/api/agents', O, ({ body, serviceContext }) => {
    const { agent, apiKey } = createAgent(db, bodyObject(body, CREATE_FIELDS), serviceContext());
    return { status: 201, body: { agent, apiKey } };
  });

  route('GET', '/api/agents/:agentId', O, ({ params }) => ({
    body: { agent: getAgent(db, params.agentId) },
  }));

  route('PUT', '/api/agents/:agentId/limits', O, ({ params, body, serviceContext }) => ({
    body: { agent: updateLimits(db, params.agentId, bodyObject(body, LIMIT_FIELDS), serviceContext()) },
  }));

  route('POST', '/api/agents/:agentId/pause', O, ({ params, serviceContext }) => ({
    body: { agent: pauseAgent(db, params.agentId, serviceContext()) },
  }));

  route('POST', '/api/agents/:agentId/resume', O, ({ params, serviceContext }) => ({
    body: { agent: resumeAgent(db, params.agentId, serviceContext()) },
  }));

  route('POST', '/api/agents/:agentId/rotate-key', O, ({ params, serviceContext }) => {
    const { agent, apiKey } = rotateApiKey(db, params.agentId, serviceContext());
    return { body: { agent, apiKey } };
  });

  route(
    'GET',
    '/api/agents/:agentId/recipients',
    O,
    ({ params, query }) => ({ body: { recipients: listRecipients(db, params.agentId, query.list) } }),
    { query: { list: 'string' } },
  );

  route('PUT', '/api/agents/:agentId/recipients/:accountId', O, ({ params, body, serviceContext }) => {
    const fields = bodyObject(body, RECIPIENT_FIELDS);
    const recipient = setRecipient(
      db,
      params.agentId,
      { accountId: params.accountId, ...fields },
      serviceContext(),
    );
    return { body: { recipient } };
  });

  route('DELETE', '/api/agents/:agentId/recipients/:accountId', O, ({ params, serviceContext }) => ({
    body: { recipient: removeRecipient(db, params.agentId, params.accountId, serviceContext()) },
  }));
}
