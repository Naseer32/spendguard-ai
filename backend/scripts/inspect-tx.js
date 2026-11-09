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
  buildTxParams,
  fixtureUrl,
  parseInspectArgs,
  shapeLines,
} from '../src/near/inspect.js';

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
    result =
      args.command === 'status'
        ? await client.call('status', [])
        : await client.call(args.method, buildTxParams(args.params, args.txHash, args.sender));
  } catch (error) {
    if (error instanceof RpcError) {
      console.error(`${error.name}: ${error.message}`);
      if (error.status !== undefined) console.error(`http status: ${error.status}`);
      if (error.reason !== undefined) console.error(`reason: ${error.reason}`);
      if (error.detail !== undefined) console.error(`detail: ${error.detail}`);
      if (error.remote) console.error(`remote error: ${error.remote}`);
      if (error instanceof RpcError && args.command === 'tx') {
        console.error('hint: try --params array, or --method EXPERIMENTAL_tx_status');
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(shapeLines(result).join('\n'));

  if (args.command === 'tx' && args.save !== null) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(fixtureUrl(args.save), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(`saved the raw response to src/near/fixtures/${args.save}`);
  }
}

main();
