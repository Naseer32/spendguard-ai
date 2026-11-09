// NEAR settings read from the environment. Used by config.js, which collects
// every problem before failing. Messages never echo values: the RPC URL can
// contain an API key.

import { parseRpcUrl } from './rpcUrl.js';

export const DEFAULT_RPC_URL = 'https://rpc.testnet.near.org';
const INTEGER_RE = /^(0|[1-9][0-9]{0,15})$/;

function readInteger(env, name, { min, max, fallback }, problems) {
  const raw = env[name];
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw !== 'string') {
    problems.push(`${name}: must be a string`);
    return fallback;
  }
  if (raw === '') {
    problems.push(`${name}: must not be empty (unset it to use the default)`);
    return fallback;
  }
  if (!INTEGER_RE.test(raw)) {
    problems.push(`${name}: must be a whole number without sign, spaces or leading zeros`);
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    problems.push(`${name}: must be between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

export function readNearConfig(env, problems) {
  let network = 'testnet';
  const rawNetwork = env.NEAR_NETWORK;
  if (rawNetwork !== undefined && rawNetwork !== 'testnet') {
    problems.push(
      rawNetwork === 'mainnet'
        ? 'NEAR_NETWORK: mainnet is not supported in this version; use testnet'
        : 'NEAR_NETWORK: must be testnet',
    );
  }

  let rpcUrl = DEFAULT_RPC_URL;
  const rawUrl = env.NEAR_RPC_URL;
  if (rawUrl !== undefined) {
    try {
      parseRpcUrl(rawUrl);
      rpcUrl = rawUrl;
    } catch {
      problems.push('NEAR_RPC_URL: must be an https URL without credentials, spaces or a fragment');
    }
  }

  const rpcTimeoutMs = readInteger(
    env, 'NEAR_RPC_TIMEOUT_MS', { min: 1000, max: 60_000, fallback: 10_000 }, problems,
  );
  const rpcMaxResponseBytes = readInteger(
    env, 'NEAR_RPC_MAX_RESPONSE_BYTES', { min: 1024, max: 8_388_608, fallback: 1_048_576 }, problems,
  );
  const submittedTimeoutMs = readInteger(
    env, 'SUBMITTED_TIMEOUT_MS', { min: 60_000, max: 86_400_000, fallback: 1_800_000 }, problems,
  );

  return Object.freeze({ network, rpcUrl, rpcTimeoutMs, rpcMaxResponseBytes, submittedTimeoutMs });
}

// Safe for logs: only the host of the RPC URL, never its path or query.
export function describeNearConfig(near) {
  return {
    network: near.network,
    rpcHost: new URL(near.rpcUrl).host,
    rpcTimeoutMs: near.rpcTimeoutMs,
    rpcMaxResponseBytes: near.rpcMaxResponseBytes,
    submittedTimeoutMs: near.submittedTimeoutMs,
  };
}
