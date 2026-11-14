#!/usr/bin/env node
// SpendGuard autonomous agent demo (NEAR Testnet only).
//
//   node agent.js send <amountInNEAR> <recipientAccount> ["purpose text"]
//
// 1. POST /api/v1/payments/evaluate (agent API key)       -> the backend decides
// 2. only if decision AND status are APPROVED: sign + send exactly that amount to
//    exactly that recipient from SOURCE_ACCOUNT
// 3. POST /api/payments/:id/tx-report (OWNER token)        -> the backend verifies on-chain
// 4. print what the backend returned. This script never decides a payment's final status.
//
// Secrets come from environment variables only and are redacted from all output.

import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Constants (shapes mirror backend/src/services/payments.js and transactions.js)
// ---------------------------------------------------------------------------

export const DEFAULT_RPC_URL = 'https://rpc.testnet.near.org';
const YOCTO_PER_NEAR = 10n ** 24n;
const HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{32,50}$/;
const ACCOUNT_RE = /^[a-z0-9._-]{2,64}$/;
const IMPLICIT_RE = /^[0-9a-f]{64}$/;
const NEAR_AMOUNT_RE = /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,24})?$/;
const MAX_PURPOSE = 500;
const MAX_RESPONSE_BYTES = 1_048_576;
const HTTP_TIMEOUT_MS = 15_000;

export const EXIT = Object.freeze({ OK: 0, ERROR: 1, NOT_APPROVED: 2, UNSETTLED: 3 });

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** "0.1" -> "100000000000000000000000". Exact integer math, no floating point. */
export function nearToYocto(input) {
  if (typeof input !== 'string' || !NEAR_AMOUNT_RE.test(input)) {
    throw new UserError('Amount must be a plain decimal NEAR number such as 0.1 (up to 24 decimals, no signs or exponents).');
  }
  const [whole, frac = ''] = input.split('.');
  const yocto = BigInt(whole) * YOCTO_PER_NEAR + BigInt(frac.padEnd(24, '0'));
  if (yocto <= 0n) throw new UserError('Amount must be greater than zero.');
  return yocto.toString();
}

/** Account ids this demo accepts: named ".testnet" accounts or 64-hex implicit accounts. */
export function isTestnetAccount(id) {
  return typeof id === 'string' && ACCOUNT_RE.test(id) && (id.endsWith('.testnet') || IMPLICIT_RE.test(id));
}

/** Throws unless every network setting points at NEAR testnet. */
export function assertTestnet({ network, rpcUrl, sourceAccount, recipient }) {
  if (network !== 'testnet') {
    throw new UserError('Refusing to run: NEAR_NETWORK must be "testnet". This demo never touches mainnet.');
  }
  let host;
  try {
    const url = new URL(rpcUrl);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('bad');
    host = url.hostname.toLowerCase();
  } catch {
    throw new UserError('Refusing to run: NEAR_RPC_URL must be an https URL without credentials.');
  }
  if (!/(^|[.-])testnet([.-]|$)/.test(host)) {
    throw new UserError('Refusing to run: NEAR_RPC_URL does not look like a testnet endpoint.');
  }
  if (!isTestnetAccount(sourceAccount)) {
    throw new UserError('Refusing to run: SOURCE_ACCOUNT must be a testnet account (ends with .testnet).');
  }
  if (recipient !== undefined && !isTestnetAccount(recipient)) {
    throw new UserError('Refusing to run: the recipient must be a testnet account (ends with .testnet).');
  }
}

export function deriveIdempotencyKey({ sourceAccount, recipient, amountYocto, purpose, salt = '' }) {
  const digest = createHash('sha256')
    .update(JSON.stringify(['spendguard-agent-demo-v1', 'send', sourceAccount, recipient, amountYocto, purpose, salt]))
    .digest('hex');
  return `sgdemo-${digest.slice(0, 40)}`; // 8..128 chars of [A-Za-z0-9._:-], as the backend requires
}

const KEY_PATTERNS = [
  /\bed25519:[1-9A-HJ-NP-Za-km-z]{16,}/g,
  /\bsecp256k1:[1-9A-HJ-NP-Za-km-z]{16,}/g,
  /\bsgk_[A-Za-z0-9_-]{8,}/g,
  /\bbearer\s+[\x21-\x7e]+/gi,
  /\b(?:api[_-]?key|token|secret|private[_-]?key)\s*[=:]\s*[^\s"',;]+/gi,
];

/** Removes anything that looks like a key or bearer token, plus the exact secret values given. */
export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 6) out = out.split(secret).join('[REDACTED]');
  }
  for (const pattern of KEY_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

// ---------------------------------------------------------------------------
// Configuration (environment only)
// ---------------------------------------------------------------------------

export function readConfig(env) {
  const missing = ['BACKEND_URL', 'AGENT_API_KEY', 'OWNER_TOKEN', 'SOURCE_ACCOUNT', 'SOURCE_PRIVATE_KEY']
    .filter((name) => typeof env[name] !== 'string' || env[name].trim() === '');
  if (missing.length > 0) {
    throw new UserError(`Missing environment variables: ${missing.join(', ')}. See .env.example.`);
  }
  let backend;
  try {
    backend = new URL(env.BACKEND_URL.trim());
  } catch {
    throw new UserError('BACKEND_URL is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(backend.protocol) || backend.username !== '' || backend.password !== '') {
    throw new UserError('BACKEND_URL must be http(s) without embedded credentials.');
  }
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(backend.hostname);
  if (backend.protocol === 'http:' && !local) {
    throw new UserError('BACKEND_URL must use https unless it points at localhost or a private network.');
  }
  return Object.freeze({
    backendUrl: backend.origin,
    agentApiKey: env.AGENT_API_KEY.trim(),
    ownerToken: env.OWNER_TOKEN.trim(),
    sourceAccount: env.SOURCE_ACCOUNT.trim(),
    sourcePrivateKey: env.SOURCE_PRIVATE_KEY.trim(),
    network: env.NEAR_NETWORK === undefined ? 'testnet' : env.NEAR_NETWORK.trim(),
    rpcUrl: env.NEAR_RPC_URL === undefined ? DEFAULT_RPC_URL : env.NEAR_RPC_URL.trim(),
    salt: env.PAYMENT_SALT === undefined ? '' : env.PAYMENT_SALT.trim(),
    stateFile: env.AGENT_STATE_FILE === undefined || env.AGENT_STATE_FILE.trim() === ''
      ? join(homedir(), '.spendguard-agent-demo', 'state.json')
      : env.AGENT_STATE_FILE.trim(),
  });
}

export function parseArgs(argv) {
  const [command, amount, recipient, ...rest] = argv;
  if (argv.some((a) => a.startsWith('--'))) {
    throw new UserError('This script takes no options. Secrets are read from environment variables only.');
  }
  if (command !== 'send' || amount === undefined || recipient === undefined) {
    throw new UserError('Usage: node agent.js send <amountInNEAR> <recipientAccount> ["purpose text"]');
  }
  const purpose = rest.join(' ').trim();
  if (purpose.length > MAX_PURPOSE || /[\u0000-\u001f\u007f]/.test(purpose)) {
    throw new UserError(`purpose must be at most ${MAX_PURPOSE} characters without control characters.`);
  }
  return { amountYocto: nearToYocto(amount), recipient, purpose };
}

// ---------------------------------------------------------------------------
// Local state: the exactly-once record. Holds only public data (hash, accounts).
// ---------------------------------------------------------------------------

export function createFileStateStore(file) {
  const lockPath = `${file}.lock`;
  const read = () => {
    if (!existsSync(file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new UserError(`The state file ${file} is unreadable. Fix or move it before sending anything.`);
    }
  };
  const write = (all) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const locked = (fn) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    let fd;
    try {
      fd = openSync(lockPath, 'wx');
    } catch {
      throw new UserError(`Another run holds ${lockPath}. If no run is active, delete that lock file and retry.`);
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try { unlinkSync(lockPath); } catch { /* already gone */ }
    }
  };
  return {
    get: (key) => read()[key] ?? null,
    /** Creates the entry or throws if one exists. Atomic against other runs. */
    begin: (key, record) => locked(() => {
      const all = read();
      if (all[key] !== undefined) throw new UserError('A payment for this command was already started. It will not be sent again.');
      all[key] = record;
      write(all);
    }),
    update: (key, patch) => locked(() => {
      const all = read();
      all[key] = { ...(all[key] ?? {}), ...patch };
      write(all);
    }),
  };
}

// ---------------------------------------------------------------------------
// Backend client (fetch injected for tests)
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function createBackend({ baseUrl, agentApiKey, ownerToken, fetchImpl = globalThis.fetch }) {
  async function request(method, path, token, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', // never forward a bearer token to another host
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'The backend could not be reached.');
    }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new ApiError(res.status, 'TOO_LARGE', 'The backend response was too large.');
    let json = null;
    try { json = text === '' ? null : JSON.parse(text); } catch { /* handled below */ }
    if (!res.ok) {
      const e = json?.error;
      throw new ApiError(res.status, typeof e?.code === 'string' ? e.code : 'HTTP_ERROR',
        typeof e?.message === 'string' ? e.message : `The backend answered HTTP ${res.status}.`, json);
    }
    // Every success body is wrapped as { data: ... } (backend/src/app.js).
    const data = json?.data;
    if (data === null || typeof data !== 'object') throw new ApiError(res.status, 'SHAPE', 'The backend sent an unreadable response.');
    return data;
  }

  return {
    evaluate: (input) => request('POST', '/api/v1/payments/evaluate', agentApiKey, input),
    getPayment: (id) => request('GET', `/api/v1/payments/${encodeURIComponent(id)}`, agentApiKey),
    reportTx: (id, { txHash, signerId }) =>
      request('POST', `/api/payments/${encodeURIComponent(id)}/tx-report`, ownerToken, { txHash, signerId }),
    listAgents: () => request('GET', '/api/agents', ownerToken),
  };
}

// ---------------------------------------------------------------------------
// NEAR sender (near-api-js is loaded lazily; tests inject a fake instead)
// ---------------------------------------------------------------------------

export async function createNearSender({ secretKey, accountId, rpcUrl }) {
  const { Account, JsonRpcProvider, KeyPairSigner, actions } = await import('near-api-js');
  let signer;
  try {
    signer = KeyPairSigner.fromSecretKey(secretKey);
  } catch {
    throw new UserError('SOURCE_PRIVATE_KEY is not a valid NEAR secret key (expected "ed25519:...").');
  }
  const account = new Account(accountId, new JsonRpcProvider({ url: rpcUrl }), signer);
  return {
    async send({ receiverId, amountYocto }) {
      const outcome = await account.signAndSendTransaction({
        receiverId,
        actions: [actions.transfer(BigInt(amountYocto))],
        throwOnFailure: false, // keep the hash even if the transfer fails on-chain; the backend reports it
        retries: 3, // only re-signs after a rejected nonce, which means nothing was sent
      });
      const txHash = [outcome?.transaction?.hash, outcome?.transaction_outcome?.id].find((h) => typeof h === 'string' && HASH_RE.test(h));
      if (txHash === undefined) throw new Error('NEAR returned no transaction hash');
      const signerId = typeof outcome?.transaction?.signer_id === 'string' ? outcome.transaction.signer_id : accountId;
      return { txHash, signerId };
    },
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function showVerdict(log, report) {
  log(`Backend verdict: ${report.verdict}`);
  if (typeof report.action === 'string') log(`Backend action:  ${report.action}`);
  if (typeof report.reason === 'string') log(`Backend reason:  ${report.reason.slice(0, 300)}`);
  log(`Backend status:  ${report.payment?.status ?? 'unknown'}`);
}

const SETTLED_VERDICTS = new Set(['VERIFIED', 'FAILED', 'MISMATCH']);

async function reportAndShow({ backend, store, key, requestId, txHash, signerId, log }) {
  let report;
  try {
    report = await backend.reportTx(requestId, { txHash, signerId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      log(`The backend refused the report: ${error.code} ${error.message}`);
      log('Do not send again. Ask the owner to review this request in the dashboard.');
      try {
        log(`Backend status:  ${(await backend.getPayment(requestId)).payment?.status ?? 'unknown'}`);
      } catch { /* status is informational here */ }
      return EXIT.UNSETTLED;
    }
    log(`The report did not complete (${error.message}). The transaction WAS sent: ${txHash}`);
    log('Re-run the same command to retry only the report. Nothing will be sent again.');
    return EXIT.UNSETTLED;
  }
  showVerdict(log, report);
  if (SETTLED_VERDICTS.has(report.verdict)) {
    store.update(key, { phase: 'reported', verdict: report.verdict, backendStatus: report.payment?.status ?? null });
    return report.verdict === 'VERIFIED' ? EXIT.OK : EXIT.ERROR;
  }
  log('Verification is not settled yet. Re-run the same command later to retry the report.');
  return EXIT.UNSETTLED;
}

/**
 * Runs one command. Returns an exit code. Every collaborator is injectable.
 * deps: { fetchImpl, createSender, store, out, now }
 */
export async function run({ argv, env, deps = {} }) {
  const out = deps.out ?? ((line) => console.log(line));
  const now = deps.now ?? (() => Date.now());
  const secrets = ['AGENT_API_KEY', 'OWNER_TOKEN', 'SOURCE_PRIVATE_KEY'].map((n) => env[n]).filter(Boolean);
  const log = (line) => out(redact(line, secrets));

  try {
    const cfg = readConfig(env);
    const { amountYocto, recipient, purpose } = parseArgs(argv);
    assertTestnet({ network: cfg.network, rpcUrl: cfg.rpcUrl, sourceAccount: cfg.sourceAccount, recipient });

    const store = deps.store ?? createFileStateStore(cfg.stateFile);
    const backend = createBackend({
      baseUrl: cfg.backendUrl, agentApiKey: cfg.agentApiKey, ownerToken: cfg.ownerToken, fetchImpl: deps.fetchImpl,
    });
    const key = deriveIdempotencyKey({
      sourceAccount: cfg.sourceAccount, recipient, amountYocto, purpose, salt: cfg.salt,
    });
    log(`Command: send ${amountYocto} yoctoNEAR to ${recipient} from ${cfg.sourceAccount} (testnet)`);
    log(`Idempotency key: ${key}`);

    // Resume: a payment for this exact command was already started.
    const existing = store.get(key);
    if (existing !== null) {
      if (existing.phase === 'sending') {
        log('A previous run started sending this payment but never recorded a transaction hash.');
        log('It may or may not have been sent. Check the account history on a NEAR testnet explorer.');
        log('Nothing was sent now. After checking, remove this entry from the state file or set PAYMENT_SALT to start a new payment.');
        return EXIT.ERROR;
      }
      if (existing.phase === 'reported') {
        log('This payment was already sent and reported. Nothing was sent now.');
        const view = (await backend.getPayment(existing.requestId)).payment;
        log(`Backend status:  ${view?.status ?? 'unknown'}`);
        return existing.verdict === 'VERIFIED' ? EXIT.OK : EXIT.ERROR;
      }
      log(`This payment was already sent (tx ${existing.txHash}). Retrying the report only.`);
      return await reportAndShow({ backend, store, key, requestId: existing.requestId, txHash: existing.txHash, signerId: existing.signerId, log });
    }

    // 1. Ask the backend.
    log('Asking SpendGuard to evaluate the payment...');
    const { payment, replayed } = await backend.evaluate({
      idempotencyKey: key, recipient, amount: amountYocto, ...(purpose === '' ? {} : { purpose }),
    });
    if (payment === null || typeof payment !== 'object') throw new ApiError(200, 'SHAPE', 'The backend sent an unreadable decision.');
    log(`Request ${payment.id}${replayed ? ' (replayed)' : ''}`);
    log(`Decision: ${payment.decision}   Status: ${payment.status}`);
    log(`Reason codes: ${(payment.reasonCodes ?? []).join(', ') || '(none)'}`);

    // 2. Only an APPROVED decision that is still APPROVED may move money.
    if (payment.decision !== 'APPROVED' || payment.status !== 'APPROVED') {
      log('Not approved for sending. No money was sent.');
      return EXIT.NOT_APPROVED;
    }
    if (payment.recipient !== recipient || payment.amount !== amountYocto) {
      log('The backend approval does not match this command (recipient or amount differs). No money was sent.');
      return EXIT.ERROR;
    }
    if (typeof payment.expiresAt === 'string' && !(Date.parse(payment.expiresAt) > now())) {
      log('The authorization window has passed. No money was sent. Run the command again for a new request (set PAYMENT_SALT).');
      return EXIT.NOT_APPROVED;
    }

    // Convenience pre-check against the agent's limits. The backend decision stays the authority.
    try {
      const agent = (await backend.listAgents()).agents?.find((a) => a?.sourceAccount === cfg.sourceAccount);
      if (agent !== undefined && /^[0-9]+$/.test(agent.perTxLimit ?? '') && BigInt(amountYocto) > BigInt(agent.perTxLimit)) {
        log('Convenience check: the amount is above the per-transaction limit. No money was sent.');
        return EXIT.NOT_APPROVED;
      }
    } catch {
      log('Convenience limit check skipped (could not read the agent limits). The backend decision still applies.');
    }

    // 3. Prepare the signer BEFORE recording intent, so a bad key never leaves a dangling marker.
    const sender = await (deps.createSender ?? createNearSender)({
      secretKey: cfg.sourcePrivateKey, accountId: cfg.sourceAccount, rpcUrl: cfg.rpcUrl,
    });

    // 4. Record intent, then send exactly the approved transfer, then record the hash.
    store.begin(key, {
      phase: 'sending', requestId: payment.id, recipient: payment.recipient, amountYocto: payment.amount, startedAt: new Date(now()).toISOString(),
    });
    let sent;
    try {
      sent = await sender.send({ receiverId: payment.recipient, amountYocto: payment.amount });
    } catch (error) {
      log(`Sending failed or was not confirmed (${error.message}).`);
      log('It may have been sent. Check the account history on a NEAR testnet explorer. This payment will not be retried automatically.');
      return EXIT.ERROR;
    }
    if (!HASH_RE.test(sent.txHash)) {
      log('The signer returned an invalid transaction hash. This payment will not be retried automatically.');
      return EXIT.ERROR;
    }
    store.update(key, { phase: 'sent', txHash: sent.txHash, signerId: sent.signerId });
    log(`Sent transaction ${sent.txHash} (signer ${sent.signerId}).`);

    // 5. Let the backend verify it and show its answer.
    return await reportAndShow({ backend, store, key, requestId: payment.id, txHash: sent.txHash, signerId: sent.signerId, log });
  } catch (error) {
    if (error instanceof UserError) log(error.message);
    else if (error instanceof ApiError) log(`Backend error (HTTP ${error.status}) ${error.code}: ${error.message}`);
    else log(`Unexpected error: ${error?.message ?? 'unknown'}`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run({ argv: process.argv.slice(2), env: process.env });
}
