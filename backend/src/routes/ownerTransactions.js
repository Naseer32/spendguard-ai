import { ACCESS } from '../http/routeKit.js';
import { createRpcClient } from '../near/rpcClient.js';
import { reportTransaction } from '../services/transactions.js';
import { bodyObject } from './util.js';

const REPORT_FIELDS = ['txHash', 'signerId'];

// POST /api/payments/:requestId/tx-report  { txHash, signerId }
// The owner reports the NEAR transaction that paid an APPROVED request; the
// backend verifies it on-chain. Always 200 with the verdict (INCONCLUSIVE and
// HOLD leave the request SUBMITTED); refusals are 4xx via the service errors.
export function registerOwnerTransactionRoutes(route, deps) {
  const { db, config } = deps;
  let client = null;
  const getRpc = () => {
    if (deps.rpc !== undefined) return deps.rpc; // tests inject a fake
    if (client === null) {
      client = createRpcClient({
        url: config.near.rpcUrl,
        timeoutMs: config.near.rpcTimeoutMs,
        maxResponseBytes: config.near.rpcMaxResponseBytes,
      });
    }
    return client;
  };

  route('POST', '/api/payments/:requestId/tx-report', ACCESS.OWNER, async ({ params, body, serviceContext }) => {
    const result = await reportTransaction(
      db,
      getRpc(),
      params.requestId,
      bodyObject(body, REPORT_FIELDS),
      serviceContext(),
    );
    return {
      body: {
        verdict: result.verdict,
        action: result.action,
        reason: result.reason,
        payment: result.request,
      },
    };
  });
}
