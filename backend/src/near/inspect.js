// Helpers for scripts/inspect-tx.js. Pure functions: nothing here prints or
// touches the network. The script exists to LOOK at real NEAR responses, so
// nothing here assumes a response format.

import { isValidNearAccountId } from '../policy/engine.js';

export const DEFAULT_RPC_URL = 'https://rpc.testnet.near.org';
export const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);
export const WAIT_UNTIL = 'FINAL';

export const USAGE = [
  'usage:',
  '  npm run inspect-tx -- status',
  '  npm run inspect-tx -- tx <txHash> <senderAccountId> [--method tx|EXPERIMENTAL_tx_status]',
  '                          [--params object|array] [--save name.json]',
  '',
  'Prints the shape of the RPC response (field paths, types, short values).',
  '--save writes the raw response to src/near/fixtures/<name>.json (public chain data only).',
  'The RPC URL comes from NEAR_RPC_URL (default: the public testnet RPC).',
].join('\n');

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const TX_HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.json$/;
const METHODS = ['tx', 'EXPERIMENTAL_tx_status'];
const STYLES = ['object', 'array'];
const FLAGS = ['method', 'params', 'save'];

export function parseInspectArgs(argv) {
  if (!Array.isArray(argv) || argv.some((item) => typeof item !== 'string')) {
    throw new TypeError('argv must be an array of strings');
  }
  const [command, ...rest] = argv;
  if (command === 'status') {
    if (rest.length > 0) {
      throw new UsageError('status takes no arguments');
    }
    return Object.freeze({ command: 'status' });
  }
  if (command !== 'tx') {
    throw new UsageError('the first argument must be status or tx');
  }

  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) {
      positional.push(item);
      continue;
    }
    const name = item.slice(2);
    if (!FLAGS.includes(name)) {
      throw new UsageError('unknown option');
    }
    if (Object.hasOwn(flags, name)) {
      throw new UsageError('an option was given twice');
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError('an option needs a value');
    }
    flags[name] = value;
    i += 1;
  }
  if (positional.length !== 2) {
    throw new UsageError('tx needs a transaction hash and a sender account');
  }
  const [txHash, sender] = positional;
  if (!TX_HASH_RE.test(txHash)) {
    throw new UsageError('the transaction hash is not valid base58');
  }
  if (!isValidNearAccountId(sender)) {
    throw new UsageError('the sender is not a valid NEAR account id');
  }
  const method = flags.method ?? 'tx';
  const params = flags.params ?? 'object';
  if (!METHODS.includes(method)) {
    throw new UsageError('method must be tx or EXPERIMENTAL_tx_status');
  }
  if (!STYLES.includes(params)) {
    throw new UsageError('params must be object or array');
  }
  if (flags.save !== undefined && !FILE_RE.test(flags.save)) {
    throw new UsageError('save must be a plain file name ending in .json');
  }
  return Object.freeze({ command: 'tx', txHash, sender, method, params, save: flags.save ?? null });
}

// The two parameter styles to try. The real RPC decides which one it accepts;
// that is exactly what the script is for.
export function buildTxParams(style, txHash, sender) {
  if (style === 'array') {
    return [txHash, sender];
  }
  return { tx_hash: txHash, sender_account_id: sender, wait_until: WAIT_UNTIL };
}

export function fixtureUrl(name) {
  if (typeof name !== 'string' || !FILE_RE.test(name)) {
    throw new UsageError('save must be a plain file name ending in .json');
  }
  return new URL(name, FIXTURE_DIR);
}

// One line per field: path, type and a short value. Arrays show their first
// items. The output is capped.
export function shapeLines(value, { maxLines = 400, maxString = 80, maxArrayItems = 3, maxDepth = 12 } = {}) {
  const lines = [];

  function walk(item, path, depth) {
    if (lines.length >= maxLines) return;
    if (item === null) {
      lines.push(`${path}: null`);
    } else if (Array.isArray(item)) {
      lines.push(`${path}: array(${item.length})`);
      if (depth >= maxDepth) return;
      item.slice(0, maxArrayItems).forEach((entry, index) => walk(entry, `${path}[${index}]`, depth + 1));
      if (item.length > maxArrayItems) {
        lines.push(`${path}: ... ${item.length - maxArrayItems} more`);
      }
    } else if (typeof item === 'object') {
      const keys = Object.keys(item);
      lines.push(`${path}: object(${keys.length})`);
      if (depth >= maxDepth) return;
      for (const key of keys) walk(item[key], `${path}.${key}`, depth + 1);
    } else if (typeof item === 'string') {
      const shown = item.length > maxString ? `${item.slice(0, maxString)}…` : item;
      lines.push(`${path}: string(${item.length}) ${JSON.stringify(shown)}`);
    } else {
      lines.push(`${path}: ${typeof item} ${String(item)}`);
    }
  }

  walk(value, '$', 0);
  if (lines.length >= maxLines) {
    lines.push('... output truncated');
  }
  return lines;
}
