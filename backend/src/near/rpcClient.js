// Minimal JSON-RPC 2.0 client over built-in fetch. It knows nothing about
// NEAR response formats; it returns the "result" of a call or throws a typed
// error.
//
// - https only (loopback http only when a test sets allowLoopbackHttp)
// - redirects are never followed
// - one timeout covers the whole call, including reading the body
// - the response size is capped (checked from the header and while streaming)
// - errors never contain the URL or server-supplied text in their message

import { RpcError, RpcHttpError, RpcNetworkError, RpcProtocolError, RpcRemoteError, RpcTimeoutError } from './rpcErrors.js';
import { parseRpcUrl } from './rpcUrl.js';

const METHOD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const OPTION_KEYS = ['url', 'timeoutMs', 'maxResponseBytes', 'fetch', 'allowLoopbackHttp'];
const REASON_RE = /^[A-Z0-9_]{1,40}$/;

function requireInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function remoteError(raw) {
  let rpcCode = null;
  let rpcMessage = null;
  if (typeof raw === 'string') {
    rpcMessage = clip(raw, 200);
  } else if (raw !== null && typeof raw === 'object') {
    rpcCode = Number.isInteger(raw.code) ? raw.code : null;
    rpcMessage = typeof raw.message === 'string' ? clip(raw.message, 200) : null;
  }
  let remote = null;
  try {
    remote = clip(JSON.stringify(raw), 500);
  } catch {
    remote = null;
  }
  return new RpcRemoteError({ rpcCode, rpcMessage, remote });
}

function classify(error) {
  if (error instanceof RpcError) {
    return error;
  }
  if (error !== null && typeof error === 'object' && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new RpcTimeoutError();
  }
  let reason = 'fetch_failed';
  const candidate = error?.cause?.code ?? error?.code;
  if (typeof candidate === 'string' && REASON_RE.test(candidate)) {
    reason = candidate;
  }
  return new RpcNetworkError(reason);
}

export function createRpcClient(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new TypeError(`unknown option ${key}`);
    }
  }
  const {
    url: rawUrl,
    timeoutMs = 10_000,
    maxResponseBytes = 1_048_576,
    fetch: fetchImpl = globalThis.fetch,
    allowLoopbackHttp = false,
  } = options;
  if (typeof allowLoopbackHttp !== 'boolean') {
    throw new TypeError('allowLoopbackHttp must be a boolean');
  }
  const url = parseRpcUrl(rawUrl, { allowLoopbackHttp });
  requireInteger(timeoutMs, 'timeoutMs', 1, 60_000);
  requireInteger(maxResponseBytes, 'maxResponseBytes', 16, 16_777_216);
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch must be a function');
  }
  const endpoint = url.href;
  let nextId = 0;

  async function readBody(res) {
    const declared = res.headers.get('content-length');
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxResponseBytes) {
      throw new RpcProtocolError('response too large');
    }
    if (res.body === null) {
      return '';
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        total += value.byteLength;
        if (total > maxResponseBytes) {
          throw new RpcProtocolError('response too large');
        }
        chunks.push(value);
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw new RpcProtocolError('response was not valid UTF-8');
    }
  }

  function parseResult(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new RpcProtocolError('response was not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RpcProtocolError('response was not a JSON object');
    }
    if (parsed.error !== undefined && parsed.error !== null) {
      throw remoteError(parsed.error);
    }
    if (!Object.hasOwn(parsed, 'result')) {
      throw new RpcProtocolError('response had neither result nor error');
    }
    return parsed.result;
  }

  // Calls an RPC method and returns its "result".
  async function call(method, params = []) {
    if (typeof method !== 'string' || !METHOD_RE.test(method)) {
      throw new TypeError('invalid RPC method name');
    }
    if (!Array.isArray(params) && !isPlainObject(params)) {
      throw new TypeError('params must be an array or a plain object');
    }
    nextId += 1;
    const body = JSON.stringify({ jsonrpc: '2.0', id: `sg-${nextId}`, method, params });
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        throw new RpcHttpError(res.status);
      }
      return parseResult(await readBody(res));
    } catch (error) {
      throw classify(error);
    }
  }

  // The host (with port) only, safe to print.
  return Object.freeze({ call, host: url.host });
}
