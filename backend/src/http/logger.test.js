import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../services/errors.js';
import { LOG_LEVELS, createLogger, redactFields, redactText } from './logger.js';

const KEY = `sgk_0123abcd-0123-4abc-8def-0123456789ab_${'f'.repeat(64)}`;
const FIXED_NOW = Date.UTC(2026, 10, 4, 12, 0, 0, 0);

function capture(options = {}) {
  const lines = [];
  const logger = createLogger({
    level: 'debug',
    write: (line) => lines.push(line),
    now: () => FIXED_NOW,
    ...options,
  });
  return { lines, logger, parsed: () => lines.map((line) => JSON.parse(line)) };
}

describe('createLogger options', () => {
  it('validates its options', () => {
    for (const bad of [null, 'x', { level: 'loud' }, { level: 5 }, { write: 'x' }, { now: 5 }, { extra: 1 }]) {
      assert.throws(() => createLogger(bad), TypeError, JSON.stringify(bad));
    }
    assert.doesNotThrow(() => createLogger({ level: 'silent' }));
    assert.doesNotThrow(() => createLogger());
  });

  it('exposes the level names', () => {
    assert.deepEqual(Object.keys(LOG_LEVELS), ['debug', 'info', 'warn', 'error', 'silent']);
  });
});

describe('levels', () => {
  it('emits only entries at or above the level', () => {
    const { lines, logger } = capture({ level: 'warn' });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => JSON.parse(l).level), ['warn', 'error']);
  });

  it('silent emits nothing', () => {
    const { lines, logger } = capture({ level: 'silent' });
    logger.error('e', { a: 1 });
    assert.equal(lines.length, 0);
  });

  it('debug emits everything', () => {
    const { lines, logger } = capture({ level: 'debug' });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    assert.equal(lines.length, 4);
  });
});

describe('line format', () => {
  it('writes one JSON line with ts, level and event first', () => {
    const { lines, logger } = capture();
    logger.info('http.request', { method: 'GET', status: 200, durationMs: 12 });
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes('\n'));
    const entry = JSON.parse(lines[0]);
    assert.deepEqual(entry, {
      ts: '2026-11-04T12:00:00.000Z',
      level: 'info',
      event: 'http.request',
      method: 'GET',
      status: 200,
      durationMs: 12,
    });
    assert.deepEqual(Object.keys(entry).slice(0, 3), ['ts', 'level', 'event']);
  });

  it('works without fields', () => {
    const { parsed, logger } = capture();
    logger.info('started');
    assert.deepEqual(parsed()[0], { ts: '2026-11-04T12:00:00.000Z', level: 'info', event: 'started' });
  });

  it('does not let fields override ts, level or event', () => {
    const { parsed, logger } = capture();
    logger.info('real_event', { ts: 'fake', level: 'fake', event: 'fake', a: 1 });
    const entry = parsed()[0];
    assert.equal(entry.ts, '2026-11-04T12:00:00.000Z');
    assert.equal(entry.level, 'info');
    assert.equal(entry.event, 'real_event');
    assert.equal(entry.a, 1);
  });

  it('replaces invalid event names', () => {
    const { parsed, logger } = capture();
    for (const event of ['', 'Bad Event', 'x'.repeat(65), undefined, null, 5, `evil ${KEY}`]) {
      logger.info(event);
    }
    for (const entry of parsed()) {
      assert.equal(entry.event, 'invalid_event');
    }
  });

  it('serializes bigint, non-finite numbers and dates', () => {
    const { parsed, logger } = capture();
    logger.info('values', { big: 123456789012345678901234567890n, nan: NaN, inf: Infinity, when: new Date(FIXED_NOW) });
    assert.deepEqual(parsed()[0].big, '123456789012345678901234567890');
    assert.equal(parsed()[0].nan, 'NaN');
    assert.equal(parsed()[0].inf, 'Infinity');
    assert.equal(parsed()[0].when, '2026-11-04T12:00:00.000Z');
  });

  it('marks unsupported values and drops undefined', () => {
    const { parsed, logger } = capture();
    logger.info('values', { fn: () => 1, sym: Symbol('x'), und: undefined, map: new Map(), cls: new (class A {})() });
    const entry = parsed()[0];
    assert.equal(entry.fn, '[UNSUPPORTED]');
    assert.equal(entry.sym, '[UNSUPPORTED]');
    assert.equal(entry.map, '[UNSUPPORTED]');
    assert.equal(entry.cls, '[UNSUPPORTED]');
    assert.equal('und' in entry, false);
  });

  it('rejects non-object fields safely', () => {
    const { parsed, logger } = capture();
    for (const fields of ['text', 5, [], null, new Map()]) {
      logger.info('x', fields);
    }
    for (const entry of parsed()) {
      assert.equal(entry.fields, '[INVALID]');
    }
  });
});

describe('redaction by key', () => {
  const sensitive = [
    'Authorization', 'authorization', 'x-api-key', 'apiKey', 'api_key', 'token', 'ownerToken',
    'OWNER_TOKEN', 'secret', 'password', 'cookie', 'set-cookie', 'body', 'rawBody', 'requestBody',
    'headers', 'payload', 'purpose', 'comment', 'note', 'notes', 'keyHash', 'api_key_hash',
    'privateKey', 'seedPhrase', 'mnemonic', 'credentials',
  ];

  it('redacts sensitive keys whatever their value', () => {
    const fields = {};
    for (const key of sensitive) fields[key] = { nested: 'visible?', n: 1 };
    const out = redactFields(fields);
    for (const key of sensitive) {
      assert.equal(out[key], '[REDACTED]', key);
    }
  });

  it('keeps ordinary keys', () => {
    const out = redactFields({
      method: 'POST', path: '/api/v1/payments/evaluate', status: 201, agentId: 'a-1',
      requestId: 'r-1', durationMs: 5, count: 3,
    });
    assert.deepEqual(out, {
      method: 'POST', path: '/api/v1/payments/evaluate', status: 201, agentId: 'a-1',
      requestId: 'r-1', durationMs: 5, count: 3,
    });
  });

  it('redacts sensitive keys at any depth', () => {
    const out = redactFields({ ctx: { inner: { authorization: 'Bearer abc', ok: 1 } } });
    assert.deepEqual(out, { ctx: { inner: { authorization: '[REDACTED]', ok: 1 } } });
  });

  it('never writes a redacted value to the output', () => {
    const { lines, logger } = capture();
    logger.info('x', {
      authorization: `Bearer ${KEY}`, headers: { authorization: KEY }, body: { purpose: 'secret plan' },
      purpose: 'buy secret thing', comment: 'private comment',
    });
    assert.ok(!lines[0].includes(KEY));
    assert.ok(!lines[0].includes('secret plan'));
    assert.ok(!lines[0].includes('secret thing'));
    assert.ok(!lines[0].includes('private comment'));
  });
});

describe('redaction by value', () => {
  it('masks SpendGuard API keys', () => {
    assert.equal(redactText(`key ${KEY} used`), 'key [REDACTED_API_KEY] used');
    assert.equal(redactText(KEY.toUpperCase()), '[REDACTED_API_KEY]');
  });

  it('masks bearer tokens', () => {
    assert.equal(redactText('Authorization: Bearer abc.def-123'), 'Authorization: Bearer [REDACTED]');
    assert.equal(redactText('bearer   xyz'), 'Bearer [REDACTED]');
  });

  it('masks long hex runs and leaves shorter ones', () => {
    assert.equal(redactText(`hash ${'a'.repeat(64)}`), 'hash [REDACTED_HEX64]');
    assert.equal(redactText('b'.repeat(70)), '[REDACTED_HEX64]');
    assert.equal(redactText('a'.repeat(63)), 'a'.repeat(63));
    assert.equal(redactText('commit 1a2b3c4'), 'commit 1a2b3c4');
  });

  it('masks NEAR-style keys', () => {
    assert.equal(redactText(`ed25519:${'3'.repeat(44)}`), '[REDACTED_KEY]');
    assert.equal(redactText(`secp256k1:${'5'.repeat(44)}`), '[REDACTED_KEY]');
    assert.equal(redactText('ed25519:short'), 'ed25519:short');
  });

  it('masks secrets inside nested values, arrays and object keys', () => {
    const out = redactFields({
      message: `failed for ${KEY}`,
      list: [`Bearer ${KEY}`, 'fine'],
      deep: { text: `ed25519:${'3'.repeat(44)}` },
      [KEY]: 'x',
    });
    const text = JSON.stringify(out);
    assert.ok(!text.includes('sgk_'));
    assert.ok(!text.includes('ed25519:3'));
    assert.deepEqual(out.list, ['Bearer [REDACTED]', 'fine']);
  });

  it('redacts a secret even when it sits past the truncation point', () => {
    const out = redactFields({ message: `${'x'.repeat(190)} ${KEY}` });
    assert.ok(!out.message.includes('sgk_'));
    assert.ok(!out.message.includes('ffff'));
  });
});

describe('size and shape limits', () => {
  it('truncates long strings', () => {
    const out = redactFields({ text: 'x'.repeat(300) });
    assert.equal(out.text, `${'x'.repeat(200)}…`);
    assert.equal(redactFields({ text: 'x'.repeat(200) }).text, 'x'.repeat(200));
  });

  it('truncates arrays', () => {
    const out = redactFields({ list: Array.from({ length: 25 }, (_, i) => i) });
    assert.equal(out.list.length, 21);
    assert.equal(out.list[19], 19);
    assert.equal(out.list[20], '[+5 more]');
    assert.equal(redactFields({ list: [1, 2, 3] }).list.length, 3);
  });

  it('caps object keys', () => {
    const big = {};
    for (let i = 0; i < 60; i += 1) big[`k${i}`] = i;
    const out = redactFields(big);
    assert.equal(Object.keys(out).length, 51);
    assert.equal(out._truncatedKeys, 10);
  });

  it('caps depth', () => {
    const out = redactFields({ a: { b: { c: { d: { e: 1 } } } } });
    assert.deepEqual(out, { a: { b: { c: { d: '[DEPTH]' } } } });
  });

  it('handles circular references', () => {
    const loop = { name: 'x' };
    loop.self = loop;
    const out = redactFields({ loop });
    assert.equal(out.loop.self, '[CIRCULAR]');
    const shared = { v: 1 };
    assert.deepEqual(redactFields({ a: shared, b: shared }), { a: { v: 1 }, b: { v: 1 } });
  });

  it('shrinks an oversized line to a marker', () => {
    const { parsed, logger } = capture();
    const fields = {};
    for (let i = 0; i < 50; i += 1) fields[`key${i}`] = 'v'.repeat(190);
    logger.info('big', fields);
    const entry = parsed()[0];
    assert.equal(entry.truncated, true);
    assert.equal(entry.event, 'big');
    assert.equal(Object.keys(entry).length, 4);
  });
});

describe('errors', () => {
  it('logs only the name and code of unknown errors, never the message', () => {
    const error = Object.assign(new Error(`failed with ${KEY}`), { code: 'ERR_X' });
    const out = redactFields({ error });
    assert.deepEqual(out.error, { name: 'Error', code: 'ERR_X' });
    assert.ok(!JSON.stringify(out).includes('failed with'));
  });

  it('includes the safe message of service errors, still redacted', () => {
    const out = redactFields({ error: new ValidationError(`bad value ${KEY}`) });
    assert.equal(out.error.name, 'ValidationError');
    assert.equal(out.error.code, 'VALIDATION');
    assert.equal(out.error.message, 'bad value [REDACTED_API_KEY]');
  });
});

describe('robustness', () => {
  it('never throws when a field getter throws', () => {
    const { parsed, logger } = capture();
    const fields = {
      get boom() {
        throw new Error('getter failed');
      },
    };
    assert.doesNotThrow(() => logger.info('x', fields));
    const entry = parsed()[0];
    assert.equal(entry.event, 'x');
    assert.equal(entry.logError, true);
  });

  it('never throws when the writer throws', () => {
    const logger = createLogger({ level: 'debug', write: () => { throw new Error('disk full'); } });
    assert.doesNotThrow(() => logger.error('x', { a: 1 }));
  });

  it('never throws when the clock misbehaves', () => {
    const logger = createLogger({ level: 'debug', write: () => {}, now: () => NaN });
    assert.doesNotThrow(() => logger.info('x'));
    const throwing = createLogger({ level: 'debug', write: () => {}, now: () => { throw new Error('clock'); } });
    assert.doesNotThrow(() => throwing.info('x'));
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(createLogger({ level: 'silent' })));
  });
});

describe('source guards', () => {
  const srcDir = path.resolve(import.meta.dirname, '..');
  const files = fs
    .readdirSync(srcDir, { recursive: true })
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => ({ name: f, source: fs.readFileSync(path.join(srcDir, f), 'utf8') }));

  // A logger call whose arguments mention headers, body or rawBody.
  const LOGS_REQUEST_DATA =
    /\blog(?:ger)?\s*\.\s*(?:debug|info|warn|error)\s*\([^;]*?\b(?:headers|body|rawBody)\b/s;

  it('scans the source files', () => {
    assert.ok(files.length > 20);
    for (const expected of ['config.js', path.join('http', 'logger.js'), path.join('http', 'ownerAuth.js')]) {
      assert.ok(files.some((f) => f.name === expected), expected);
    }
  });

  it('uses console nowhere in the source', () => {
    for (const { name, source } of files) {
      assert.ok(!/\bconsole\s*\./.test(source), `${name} uses console`);
    }
  });

  it('never passes headers or request bodies to a logger call', () => {
    for (const { name, source } of files) {
      assert.ok(!LOGS_REQUEST_DATA.test(source), `${name} logs headers or body`);
    }
  });

  it('the logger-call detector finds bad examples and accepts good ones', () => {
    const bad = [
      "logger.info('x', { headers: req.headers });",
      "logger.error('x', req.body);",
      "log.warn('x', { rawBody });",
      'logger.debug(\n  "x",\n  { body },\n);',
    ];
    for (const sample of bad) assert.ok(LOGS_REQUEST_DATA.test(sample), sample);
    const good = [
      "logger.info('x', { status: 200 });",
      "logger.error('x', { errorName: error.name });",
      "const headers = {}; logger.info('x', { a: 1 });",
    ];
    for (const sample of good) assert.ok(!LOGS_REQUEST_DATA.test(sample), sample);
  });
});
