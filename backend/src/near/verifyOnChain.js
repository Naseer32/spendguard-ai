// Stage 3b-4, piece 2: collect the evidence for one transaction and return the
// verdict from verifyTransfer. The only I/O here is the injected `rpc` client
// ({ call(method, params) }). Never throws; anything unexpected is HOLD or
// INCONCLUSIVE, never VERIFIED.
//
// Lookup mapping:
//   tx returned a result                       FOUND
//   RPC error UNKNOWN_TRANSACTION (HANDLER_ERROR cause)   NOT_FOUND
//   anything else (timeout / NOT_OBSERVED, network, HTTP,
//   protocol, other RPC errors)                NOT_OBSERVED (INCONCLUSIVE, retry)
// If the chain or block lookup fails, the transaction is also reported as
// NOT_OBSERVED: we could not finish checking, so nothing changes.

import { checkExecution } from './executionOutcome.js';
import { matchAuthorization } from './matchAuthorization.js';
import { transferDetailsMatch } from './transferDetails.js';
import { checkBlockTime } from './blockTime.js';
import { verifyTransfer, LOOKUP } from './verifyTransfer.js';

const EXPECTED_CHAIN_ID = 'testnet';

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function lookupFromError(error) {
  try {
    if (error?.code === 'RPC_REMOTE' && typeof error.remote === 'string') {
      const parsed = JSON.parse(error.remote);
      if (parsed?.name === 'HANDLER_ERROR' && parsed?.cause?.name === 'UNKNOWN_TRANSACTION') {
        return LOOKUP.NOT_FOUND;
      }
    }
  } catch {
    // fall through
  }
  return LOOKUP.NOT_OBSERVED;
}

// input: { rpc, authorization: { txHash, signerId, receiverId, amount },
//          authorizedAt, submittedAt, now (UTC ISO strings),
//          hashAlreadyUsed: boolean }
async function run(input) {
  const { rpc, authorization, authorizedAt, submittedAt, now, hashAlreadyUsed } = input;
  const notObserved = () => verifyTransfer({ lookup: LOOKUP.NOT_OBSERVED });

  let result;
  try {
    result = await rpc.call('tx', {
      tx_hash: authorization.txHash,
      sender_account_id: authorization.signerId,
      wait_until: 'FINAL',
    });
  } catch (error) {
    const lookup = lookupFromError(error);
    return verifyTransfer(lookup === LOOKUP.NOT_FOUND ? { lookup, submittedAt, now } : { lookup });
  }

  let chainOk;
  try {
    const status = await rpc.call('status', []);
    chainOk = isObject(status) && status.chain_id === EXPECTED_CHAIN_ID;
  } catch {
    return notObserved();
  }

  const execution = checkExecution(result);
  const match = matchAuthorization(result, authorization);
  const detailsMatch = transferDetailsMatch(result, authorization);

  // The block time is only needed when execution succeeded and the details match.
  let time;
  if (chainOk && execution.ok && match.ok) {
    const blockHash = result?.transaction_outcome?.block_hash;
    if (typeof blockHash === 'string' && blockHash !== '') {
      let block;
      try {
        block = await rpc.call('block', { block_id: blockHash });
      } catch {
        return notObserved();
      }
      time = checkBlockTime({ blockTimestampNanosec: block?.header?.timestamp_nanosec, authorizedAt });
    }
  }

  return verifyTransfer({
    lookup: LOOKUP.FOUND,
    chainOk,
    execution,
    match,
    transferDetailsMatch: detailsMatch,
    time,
    hashAlreadyUsed,
  });
}

export async function verifyOnChain(input) {
  try {
    if (!isObject(input) || !isObject(input.rpc) || typeof input.rpc.call !== 'function' || !isObject(input.authorization)) {
      return verifyTransfer({ lookup: 'INVALID' }); // HOLD
    }
    return await run(input);
  } catch {
    return verifyTransfer({ lookup: 'INVALID' }); // HOLD
  }
}
