// Database schema as versioned migrations.
//
// RULES
// - Never edit a released migration. Add a new one with the next version.
// - Migrations must not contain BEGIN or COMMIT. The migrator runs them
//   inside one write transaction.
// - Amount columns hold yoctoNEAR as canonical decimal TEXT (digits only, no
//   leading zeros, at most 40 characters). Never use SQL SUM or arithmetic on
//   them: SQLite would overflow or convert them to floating point. Sum in
//   JavaScript with BigInt.

const yocto = (c) =>
  `typeof(${c}) = 'text' AND length(${c}) BETWEEN 1 AND 40 AND ${c} NOT GLOB '*[^0-9]*' AND (${c} = '0' OR ${c} NOT GLOB '0*')`;

const iso = (c) =>
  `typeof(${c}) = 'text' AND ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;

const isoOrNull = (c) => `${c} IS NULL OR (${iso(c)})`;

const day = (c) =>
  `typeof(${c}) = 'text' AND ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

const hex64 = (c) =>
  `typeof(${c}) = 'text' AND length(${c}) = 64 AND ${c} NOT GLOB '*[^0-9a-f]*'`;

const jsonText = (c) => `typeof(${c}) = 'text' AND json_valid(${c})`;

// a <= b for canonical digit strings (shorter is smaller, same length compares lexically).
const lte = (a, b) =>
  `length(${a}) < length(${b}) OR (length(${a}) = length(${b}) AND ${a} <= ${b})`;

const inList = (c, values) =>
  `${c} IN (${values.map((v) => `'${v}'`).join(', ')})`;

const REQUEST_STATUSES = [
  'BLOCKED', 'APPROVAL_REQUIRED', 'APPROVED', 'REJECTED', 'EXPIRED',
  'CANCELLED', 'SUBMITTED', 'EXECUTED', 'FAILED', 'MISMATCH',
];

const SCHEMA_V1 = `
CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (${inList('status', ['ACTIVE', 'PAUSED'])}),
  api_key_hash TEXT NOT NULL CHECK (${hex64('api_key_hash')}),
  source_account TEXT NOT NULL CHECK (length(source_account) BETWEEN 2 AND 64),
  daily_budget TEXT NOT NULL CHECK (${yocto('daily_budget')}),
  per_tx_limit TEXT NOT NULL CHECK (${yocto('per_tx_limit')}),
  approval_threshold TEXT NOT NULL CHECK (${yocto('approval_threshold')}),
  created_at TEXT NOT NULL CHECK (${iso('created_at')}),
  updated_at TEXT NOT NULL CHECK (${iso('updated_at')}),
  CHECK (${lte('approval_threshold', 'per_tx_limit')})
);

CREATE TABLE recipients (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  agent_id TEXT NOT NULL REFERENCES agents (id),
  account_id TEXT NOT NULL CHECK (length(account_id) BETWEEN 2 AND 64),
  list_type TEXT NOT NULL CHECK (${inList('list_type', ['ALLOW', 'BLOCK'])}),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL CHECK (${iso('created_at')}),
  UNIQUE (agent_id, account_id)
);

CREATE TABLE payment_requests (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  agent_id TEXT NOT NULL REFERENCES agents (id),
  recipient TEXT NOT NULL CHECK (length(recipient) BETWEEN 1 AND 128),
  amount TEXT NOT NULL CHECK (${yocto('amount')}),
  purpose TEXT CHECK (purpose IS NULL OR length(purpose) <= 500),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (${hex64('request_hash')}),
  decision TEXT NOT NULL CHECK (${inList('decision', ['APPROVED', 'BLOCKED', 'APPROVAL_REQUIRED'])}),
  status TEXT NOT NULL CHECK (${inList('status', REQUEST_STATUSES)}),
  reason_codes TEXT NOT NULL CHECK (${jsonText('reason_codes')}),
  policy_snapshot TEXT NOT NULL CHECK (${jsonText('policy_snapshot')}),
  ai_explanation TEXT CHECK (ai_explanation IS NULL OR length(ai_explanation) <= 2000),
  ai_provider TEXT CHECK (ai_provider IS NULL OR length(ai_provider) <= 64),
  created_at TEXT NOT NULL CHECK (${iso('created_at')}),
  decided_at TEXT CHECK (${isoOrNull('decided_at')}),
  expires_at TEXT CHECK (${isoOrNull('expires_at')}),
  updated_at TEXT NOT NULL CHECK (${iso('updated_at')}),
  UNIQUE (agent_id, idempotency_key),
  CHECK (decision <> 'BLOCKED' OR status = 'BLOCKED')
);

CREATE INDEX idx_requests_agent_status ON payment_requests (agent_id, status);
CREATE INDEX idx_requests_created ON payment_requests (created_at);

CREATE TABLE budget_reservations (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  request_id TEXT NOT NULL UNIQUE REFERENCES payment_requests (id),
  agent_id TEXT NOT NULL REFERENCES agents (id),
  amount TEXT NOT NULL CHECK (${yocto('amount')}),
  budget_day TEXT NOT NULL CHECK (${day('budget_day')}),
  status TEXT NOT NULL CHECK (${inList('status', ['ACTIVE', 'CONSUMED', 'RELEASED'])}),
  release_reason TEXT CHECK (release_reason IS NULL OR length(release_reason) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL CHECK (${iso('created_at')}),
  updated_at TEXT NOT NULL CHECK (${iso('updated_at')}),
  CHECK ((status = 'RELEASED') = (release_reason IS NOT NULL))
);

CREATE INDEX idx_reservations_budget ON budget_reservations (agent_id, budget_day, status);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  request_id TEXT NOT NULL UNIQUE REFERENCES payment_requests (id),
  decision TEXT NOT NULL CHECK (${inList('decision', ['APPROVE', 'REJECT'])}),
  decided_by TEXT NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 128),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 500),
  recheck_result TEXT NOT NULL CHECK (${jsonText('recheck_result')}),
  decided_at TEXT NOT NULL CHECK (${iso('decided_at')})
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  request_id TEXT NOT NULL UNIQUE REFERENCES payment_requests (id),
  near_tx_hash TEXT NOT NULL UNIQUE CHECK (length(near_tx_hash) BETWEEN 32 AND 64 AND near_tx_hash NOT GLOB '*[^1-9A-HJ-NP-Za-km-z]*'),
  signer_account_id TEXT NOT NULL CHECK (length(signer_account_id) BETWEEN 2 AND 64),
  verification_status TEXT NOT NULL CHECK (${inList('verification_status', ['PENDING', 'VERIFIED', 'FAILED', 'MISMATCH'])}),
  verification_detail TEXT CHECK (verification_detail IS NULL OR (${jsonText('verification_detail')})),
  block_height INTEGER CHECK (block_height IS NULL OR block_height >= 0),
  block_timestamp_ns TEXT CHECK (block_timestamp_ns IS NULL OR (length(block_timestamp_ns) BETWEEN 1 AND 20 AND block_timestamp_ns NOT GLOB '*[^0-9]*')),
  submitted_at TEXT NOT NULL CHECK (${iso('submitted_at')}),
  verified_at TEXT CHECK (${isoOrNull('verified_at')}),
  CHECK ((verification_status = 'PENDING') = (verified_at IS NULL))
);

CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY CHECK (seq >= 1),
  ts TEXT NOT NULL CHECK (${iso('ts')}),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  event TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 64),
  entity_id TEXT CHECK (entity_id IS NULL OR length(entity_id) BETWEEN 1 AND 128),
  payload TEXT NOT NULL CHECK (${jsonText('payload')}),
  prev_hash TEXT NOT NULL CHECK (${hex64('prev_hash')}),
  hash TEXT NOT NULL UNIQUE CHECK (${hex64('hash')})
);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
`;

export const MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, name: 'initial schema', sql: SCHEMA_V1 }),
]);

export const LATEST_VERSION = MIGRATIONS.length;
