// Looks at real NEAR RPC responses. See `npm run inspect-tx` for usage.
// This script prints; the code under src/ never does.

import fs from 'node:fs';
import { createRpcClient } from '../src/near/rpcClient.js';
import { RpcError } from '../src/near/rpcErrors.js';
import {
  DEFAULT_RPC_URL,
  FIXTURE_DIR,
  USAGE,
  UsageError,
  buildBlockParams,
  buildTxParams,
  fixtureUrl,
  parseInspectArgs,
  shapeLines,
} from '../src/near/inspect.js';

function fetchResult(client, args) {
  if (args.command === 'status') {
    return client.call('status', []);
  }
  if (args.command === 'block') {
    return client.call('block', buildBlockParams(args.blockHash));
  }
  return client.call(args.method, buildTxParams(args.params, args.txHash, args.sender));
}

async function main() {
  let args;
  try {
    args = parseInspectArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  let client;
  try {
    client = createRpcClient({ url: process.env.NEAR_RPC_URL ?? DEFAULT_RPC_URL });
  } catch {
    console.error('NEAR_RPC_URL is not a valid https URL');
    process.exitCode = 1;
    return;
  }
  console.log(`RPC host: ${client.host}`);

  let result;
  try {
    result = await fetchResult(client, args);
  } catch (error) {
    if (error instanceof RpcError) {
      console.error(`${error.name}: ${error.message}`);
      if (error.status !== undefined) console.error(`http status: ${error.status}`);
      if (error.reason !== undefined) console.error(`reason: ${error.reason}`);
      if (error.detail !== undefined) console.error(`detail: ${error.detail}`);
      if (error.remote) console.error(`remote error: ${error.remote}`);
      if (args.command === 'tx') {
        console.error('hint: try --params array, or --method EXPERIMENTAL_tx_status');
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(shapeLines(result).join('\n'));

  if (args.save !== null) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    try {
      fs.writeFileSync(fixtureUrl(args.save), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') {
        console.error(`not saved: src/near/fixtures/${args.save} already exists (delete it or pick another name)`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    console.log(`saved the raw response to src/near/fixtures/${args.save}`);
  }
}

main();
