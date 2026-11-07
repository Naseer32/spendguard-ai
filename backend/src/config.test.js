import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hashOwnerToken } from './http/ownerAuth.js';
import { resolveSettings } from './services/requestState.js';
import { BODY_LIMIT_BYTES, ConfigError, describeConfig, loadConfig } from './config.js';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const env = (over = {}) => ({ OWNER_TOKEN: TOKEN, ...over });

function problemsOf(over) {
  try {
    loadConfig(over);
  } catch (error) {
    assert.ok(error instanceof ConfigError, 'expected a ConfigError');
    return error;
  }
  return assert.fail('expected loadConfig to throw');
}

function assertRejected(variable, value, label = String(value)) {
  const error = problemsOf(env({ [variable]: value }));
  assert.equal(error.problems.length, 1, `${variable}=${label}: ${error.problems.join('; ')}`);
  assert.ok(error.problems[0].startsWith(`${variable}:`), `${variable}=${label}`);
}

describe('defaults', () => {
  it('needs only the owner token', () => {
    const c = loadConfig(env());
    assert.equal(c.ownerTokenHash, hashOwnerToken(TOKEN));
    assert.equal(c.dbPath, 'spendguard.sqlite');
    assert.equal(c.host, '127.0.0.1');
    assert.equal(c.port, 3000);
    assert.deepEqual([...c.corsOrigins], []);
    assert.deepEqual({ ...c.settings }, { approvalWindowMs: 86_400_000, authorizationWindowMs: 3_600_000 });
    assert.deepEqual({ ...c.rateLimits }, { authFailuresPerMinute: 10, evaluatePerMinute: 60, ownerPerMinute: 300 });
    assert.equal(c.bodyLimitBytes, 16384);
    assert.equal(c.bodyLimitBytes, BODY_LIMIT_BYTES);
    assert.equal(c.sweepIntervalMs, 60_000);
    assert.equal(c.logLevel, 'info');
  });

  it('returns a deeply frozen config without the raw token', () => {
    const c = loadConfig(env({ CORS_ORIGINS: 'https://app.example.com' }));
    assert.ok(Object.isFrozen(c));
    assert.ok(Object.isFrozen(c.corsOrigins));
    assert.ok(Object.isFrozen(c.settings));
    assert.ok(Object.isFrozen(c.rateLimits));
    assert.ok(!JSON.stringify(c).includes(TOKEN));
    assert.deepEqual(Object.keys(c).sort(), [
      'bodyLimitBytes', 'corsOrigins', 'dbPath', 'host', 'logLevel', 'ownerTokenHash',
      'port', 'rateLimits', 'settings', 'sweepIntervalMs',
    ]);
  });

  it('ignores unrelated environment variables', () => {
    const c = loadConfig(env({ HOME: '/home/x', PATH: '/bin', UNRELATED: 'y' }));
    assert.equal(c.port, 3000);
  });

  it('keeps default windows consistent with the service settings', () => {
    const c = loadConfig(env());
    const resolved = resolveSettings(c.settings);
    assert.equal(resolved.approvalWindowMs, c.settings.approvalWindowMs);
    assert.equal(resolved.authorizationWindowMs, c.settings.authorizationWindowMs);
    const edges = loadConfig(env({ APPROVAL_WINDOW_MS: '1000', AUTHORIZATION_WINDOW_MS: '2592000000' }));
    assert.doesNotThrow(() => resolveSettings(edges.settings));
  });
});

describe('overrides', () => {
  it('accepts every variable', () => {
    const c = loadConfig({
      OWNER_TOKEN: TOKEN,
      DB_PATH: '/data/spend.sqlite',
      HOST: '0.0.0.0',
      PORT: '8080',
      CORS_ORIGINS: 'https://app.example.com,http://localhost:5173',
      APPROVAL_WINDOW_MS: '7200000',
      AUTHORIZATION_WINDOW_MS: '600000',
      SWEEP_INTERVAL_MS: '30000',
      RATE_LIMIT_AUTH_FAILURES_PER_MINUTE: '5',
      RATE_LIMIT_EVALUATE_PER_MINUTE: '120',
      RATE_LIMIT_OWNER_PER_MINUTE: '600',
      LOG_LEVEL: 'warn',
    });
    assert.equal(c.dbPath, '/data/spend.sqlite');
    assert.equal(c.host, '0.0.0.0');
    assert.equal(c.port, 8080);
    assert.deepEqual([...c.corsOrigins], ['https://app.example.com', 'http://localhost:5173']);
    assert.deepEqual({ ...c.settings }, { approvalWindowMs: 7_200_000, authorizationWindowMs: 600_000 });
    assert.equal(c.sweepIntervalMs, 30_000);
    assert.deepEqual({ ...c.rateLimits }, { authFailuresPerMinute: 5, evaluatePerMinute: 120, ownerPerMinute: 600 });
    assert.equal(c.logLevel, 'warn');
  });

  it('does not read process.env when an env object is given', () => {
    const before = process.env.OWNER_TOKEN;
    process.env.OWNER_TOKEN = 'z'.repeat(5);
    try {
      assert.equal(loadConfig(env()).ownerTokenHash, hashOwnerToken(TOKEN));
    } finally {
      if (before === undefined) delete process.env.OWNER_TOKEN;
      else process.env.OWNER_TOKEN = before;
    }
  });
});

describe('OWNER_TOKEN', () => {
  it('is required', () => {
    for (const e of [{}, { OWNER_TOKEN: undefined }, { OWNER_TOKEN: '' }]) {
      const error = problemsOf(e);
      assert.deepEqual([...error.problems], ['OWNER_TOKEN: is required']);
    }
  });

  it('accepts exactly 32 to 256 printable characters', () => {
    assert.doesNotThrow(() => loadConfig(env({ OWNER_TOKEN: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' })));
    assert.doesNotThrow(() => loadConfig(env({ OWNER_TOKEN: 'a1b2c3d4'.repeat(32) })));
    assert.doesNotThrow(() => loadConfig(env({ OWNER_TOKEN: '!@#$%^&*()_+-=abcdefgh0123456789XYZ' })));
  });

  it('rejects bad tokens with a message that never contains the token', () => {
    const bad = [
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d', // 31 characters
      'k9'.repeat(128) + 'x', // 257 characters
      'a1b2c3d4e5f6a7b8 c9d0e1f2a3b4c5d6', // space
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6\n', // newline
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d\u00e9', // non-ASCII
      'a'.repeat(40), // repetitive
      'ab'.repeat(20), // repetitive
      'abcdefg'.repeat(5), // 7 distinct characters
      ' ', 'short',
    ];
    for (const token of bad) {
      const error = problemsOf({ OWNER_TOKEN: token });
      assert.equal(error.problems.length, 1, JSON.stringify(token));
      assert.ok(error.problems[0].startsWith('OWNER_TOKEN:'));
      if (token.trim() !== '') {
        assert.ok(!error.message.includes(token), 'the message leaked the token');
      }
    }
  });

  it('accepts a token with exactly 8 distinct characters', () => {
    assert.doesNotThrow(() => loadConfig(env({ OWNER_TOKEN: 'abcdefgh'.repeat(4) })));
  });

  it('rejects a non-string token', () => {
    for (const token of [12345678901234567890123456789012, {}, [], true]) {
      const error = problemsOf({ OWNER_TOKEN: token });
      assert.deepEqual([...error.problems], ['OWNER_TOKEN: must be 32 to 256 printable characters without spaces']);
    }
  });
});

describe('PORT', () => {
  it('accepts the full range', () => {
    for (const [raw, expected] of [['0', 0], ['1', 1], ['3000', 3000], ['65535', 65535]]) {
      assert.equal(loadConfig(env({ PORT: raw })).port, expected);
    }
  });

  it('rejects everything else', () => {
    for (const raw of ['65536', '-1', '3000.5', '0x10', '', ' 80', '80 ', 'abc', '01', '00', '1e3', '+80', 3000]) {
      assertRejected('PORT', raw);
    }
  });
});

describe('HOST', () => {
  it('accepts IP addresses and localhost', () => {
    for (const host of ['127.0.0.1', '0.0.0.0', '::1', '::', '192.168.1.10', 'localhost']) {
      assert.equal(loadConfig(env({ HOST: host })).host, host);
    }
  });

  it('rejects hostnames and malformed values', () => {
    for (const host of ['example.com', '', '256.1.1.1', '127.0.0.1:80', 'LOCALHOST', ' 127.0.0.1', 5]) {
      assertRejected('HOST', host);
    }
  });
});

describe('CORS_ORIGINS', () => {
  it('accepts exact origins and removes duplicates', () => {
    const c = loadConfig(env({ CORS_ORIGINS: 'https://a.example.com,http://localhost:5173,https://a.example.com' }));
    assert.deepEqual([...c.corsOrigins], ['https://a.example.com', 'http://localhost:5173']);
  });

  it('rejects wildcards, paths, trailing slashes, other schemes and sloppy forms', () => {
    const bad = [
      '*', 'https://a.example.com/', 'https://a.example.com/path', 'ftp://a.example.com',
      'https://A.example.com', 'https://a.example.com:443', 'http://a.example.com:80',
      'not a url', 'a.example.com', ' https://a.example.com', 'https://a.example.com ',
      'https://a.example.com,', ',https://a.example.com', 'https://a.example.com,*', '', 5,
      'javascript:alert(1)', 'null',
    ];
    for (const origins of bad) {
      const error = problemsOf(env({ CORS_ORIGINS: origins }));
      assert.ok(error.problems.every((p) => p.startsWith('CORS_ORIGINS:')), String(origins));
      assert.ok(error.problems.length >= 1, String(origins));
    }
  });

  it('allows at most 20 origins', () => {
    const make = (n) => Array.from({ length: n }, (_, i) => `https://a${i}.example.com`).join(',');
    assert.equal(loadConfig(env({ CORS_ORIGINS: make(20) })).corsOrigins.length, 20);
    assertRejected('CORS_ORIGINS', make(21));
  });
});

describe('time windows and limits', () => {
  it('enforces the window bounds', () => {
    for (const name of ['APPROVAL_WINDOW_MS', 'AUTHORIZATION_WINDOW_MS']) {
      assert.doesNotThrow(() => loadConfig(env({ [name]: '1000' })));
      assert.doesNotThrow(() => loadConfig(env({ [name]: '2592000000' })));
      for (const raw of ['999', '2592000001', '0', '-1', '1.5', 'abc', '', '01']) {
        assertRejected(name, raw);
      }
    }
  });

  it('enforces the sweep interval bounds', () => {
    assert.doesNotThrow(() => loadConfig(env({ SWEEP_INTERVAL_MS: '1000' })));
    assert.doesNotThrow(() => loadConfig(env({ SWEEP_INTERVAL_MS: '3600000' })));
    for (const raw of ['999', '3600001', '0', 'x', '']) {
      assertRejected('SWEEP_INTERVAL_MS', raw);
    }
  });

  it('enforces the rate limit bounds', () => {
    for (const name of [
      'RATE_LIMIT_AUTH_FAILURES_PER_MINUTE', 'RATE_LIMIT_EVALUATE_PER_MINUTE', 'RATE_LIMIT_OWNER_PER_MINUTE',
    ]) {
      assert.doesNotThrow(() => loadConfig(env({ [name]: '1' })));
      assert.doesNotThrow(() => loadConfig(env({ [name]: '100000' })));
      for (const raw of ['0', '100001', '-5', '2.5', 'many', '']) {
        assertRejected(name, raw);
      }
    }
  });
});

describe('LOG_LEVEL and DB_PATH', () => {
  it('accepts the known log levels only', () => {
    for (const level of ['debug', 'info', 'warn', 'error', 'silent']) {
      assert.equal(loadConfig(env({ LOG_LEVEL: level })).logLevel, level);
    }
    for (const level of ['verbose', 'INFO', '', 'trace', 5]) {
      assertRejected('LOG_LEVEL', level);
    }
  });

  it('validates the database path', () => {
    assert.equal(loadConfig(env({ DB_PATH: ':memory:' })).dbPath, ':memory:');
    assert.equal(loadConfig(env({ DB_PATH: 'x'.repeat(1024) })).dbPath.length, 1024);
    for (const path of ['', 'a\u0000b', 'a\nb', 'x'.repeat(1025), 5]) {
      assertRejected('DB_PATH', path);
    }
  });
});

describe('reporting', () => {
  it('reports every problem at once', () => {
    const error = problemsOf({ OWNER_TOKEN: 'short', PORT: 'abc', HOST: 'example.com', LOG_LEVEL: 'loud' });
    assert.equal(error.problems.length, 4);
    assert.match(error.message, /4 problems/);
    for (const name of ['OWNER_TOKEN', 'PORT', 'HOST', 'LOG_LEVEL']) {
      assert.ok(error.problems.some((p) => p.startsWith(`${name}:`)), name);
    }
  });

  it('never echoes provided values in any message', () => {
    const secretish = 'my-very-secret-value-0123456789-abcdef';
    const error = problemsOf({
      OWNER_TOKEN: 'short', PORT: secretish, HOST: secretish, CORS_ORIGINS: secretish,
      DB_PATH: '', LOG_LEVEL: secretish, APPROVAL_WINDOW_MS: secretish,
    });
    assert.ok(!error.message.includes(secretish));
    assert.ok(!JSON.stringify(error.problems).includes(secretish));
  });

  it('exposes frozen problems and a ConfigError name', () => {
    const error = problemsOf({});
    assert.equal(error.name, 'ConfigError');
    assert.ok(error instanceof Error);
    assert.ok(Object.isFrozen(error.problems));
  });

  it('rejects non-string values and a non-object env', () => {
    assertRejected('PORT', 3000);
    assertRejected('LOG_LEVEL', null);
    for (const bad of [null, undefined === 1, 'x', 5]) {
      if (bad === undefined) continue;
      assert.throws(() => loadConfig(bad), TypeError);
    }
  });
});

describe('describeConfig', () => {
  it('summarizes the configuration without the token hash', () => {
    const c = loadConfig(env({ CORS_ORIGINS: 'https://app.example.com' }));
    const summary = describeConfig(c);
    assert.equal(summary.ownerTokenConfigured, true);
    assert.equal(summary.port, 3000);
    assert.deepEqual(summary.corsOrigins, ['https://app.example.com']);
    const text = JSON.stringify(summary);
    assert.ok(!text.includes(c.ownerTokenHash));
    assert.ok(!text.includes(TOKEN));
    assert.ok(!('ownerTokenHash' in summary));
  });
});

describe('source guard', () => {
  it('never logs', () => {
    const source = fs.readFileSync(new URL('./config.js', import.meta.url), 'utf8');
    assert.ok(!/\bconsole\s*\./.test(source));
  });
});
