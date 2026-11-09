import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ConfigError, describeConfig, loadConfig } from '../config.js';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const env = (over = {}) => ({ OWNER_TOKEN: TOKEN, ...over });

function problemsOf(over) {
  try {
    loadConfig(over);
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error;
  }
  return assert.fail('expected loadConfig to throw');
}

function assertRejected(variable, value) {
  const error = problemsOf(env({ [variable]: value }));
  assert.equal(error.problems.length, 1, `${variable}=${String(value)}: ${error.problems.join('; ')}`);
  assert.ok(error.problems[0].startsWith(`${variable}:`), `${variable}=${String(value)}`);
  return error;
}

describe('NEAR defaults and overrides', () => {
  it('defaults to testnet with the approved limits', () => {
    const { near } = loadConfig(env());
    assert.deepEqual({ ...near }, {
      network: 'testnet',
      rpcUrl: 'https://rpc.testnet.near.org',
      rpcTimeoutMs: 10_000,
      rpcMaxResponseBytes: 1_048_576,
      submittedTimeoutMs: 1_800_000,
    });
    assert.ok(Object.isFrozen(near));
  });

  it('accepts overrides', () => {
    const { near } = loadConfig(env({
      NEAR_NETWORK: 'testnet',
      NEAR_RPC_URL: 'https://rpc.example.com/v2/abc?x=1',
      NEAR_RPC_TIMEOUT_MS: '5000',
      NEAR_RPC_MAX_RESPONSE_BYTES: '2048',
      SUBMITTED_TIMEOUT_MS: '120000',
    }));
    assert.equal(near.rpcUrl, 'https://rpc.example.com/v2/abc?x=1');
    assert.equal(near.rpcTimeoutMs, 5000);
    assert.equal(near.rpcMaxResponseBytes, 2048);
    assert.equal(near.submittedTimeoutMs, 120000);
  });
});

describe('NEAR_NETWORK', () => {
  it('only testnet is allowed, and mainnet is refused explicitly', () => {
    const mainnet = assertRejected('NEAR_NETWORK', 'mainnet');
    assert.match(mainnet.problems[0], /mainnet is not supported/);
    for (const value of ['localnet', 'TESTNET', '', 'betanet', 5]) {
      assertRejected('NEAR_NETWORK', value);
    }
  });
});

describe('NEAR_RPC_URL', () => {
  it('rejects unsafe or malformed URLs without echoing them', () => {
    const secretish = [
      'http://rpc.example.com/SECRET-KEY-123', 'https://user:SECRETPASS@rpc.example.com',
      'https://rpc.example.com/#SECRETFRAG', 'ftp://rpc.example.com/SECRET', 'not a url SECRET',
    ];
    for (const value of secretish) {
      const error = assertRejected('NEAR_RPC_URL', value);
      assert.ok(!error.message.includes('SECRET'), value);
    }
    for (const value of ['', ' ', 'http://rpc.testnet.near.org', 'https://', 5, `https://${'a'.repeat(2050)}.com`]) {
      assertRejected('NEAR_RPC_URL', value);
    }
  });
});

describe('NEAR numbers', () => {
  it('enforces the bounds', () => {
    const cases = [
      ['NEAR_RPC_TIMEOUT_MS', '1000', '60000', ['999', '60001', '0', '-1', '1.5', 'abc', '', '01']],
      ['NEAR_RPC_MAX_RESPONSE_BYTES', '1024', '8388608', ['1023', '8388609', '0', 'big', '', '01']],
      ['SUBMITTED_TIMEOUT_MS', '60000', '86400000', ['59999', '86400001', '0', 'x', '', '01']],
    ];
    for (const [name, low, high, bad] of cases) {
      assert.doesNotThrow(() => loadConfig(env({ [name]: low })));
      assert.doesNotThrow(() => loadConfig(env({ [name]: high })));
      for (const value of bad) assertRejected(name, value);
    }
  });

  it('reports NEAR problems together with others', () => {
    const error = problemsOf({ OWNER_TOKEN: 'short', NEAR_NETWORK: 'mainnet', NEAR_RPC_TIMEOUT_MS: 'x' });
    assert.equal(error.problems.length, 3);
  });
});

describe('describeConfig', () => {
  it('shows only the host of the RPC URL', () => {
    const config = loadConfig(env({ NEAR_RPC_URL: 'https://rpc.example.com/v2/SECRETKEY?apikey=SECRETQUERY' }));
    const summary = describeConfig(config);
    assert.equal(summary.near.rpcHost, 'rpc.example.com');
    assert.equal(summary.near.network, 'testnet');
    const text = JSON.stringify(summary);
    assert.ok(!text.includes('SECRET'));
    assert.ok(!text.includes('apikey'));
    assert.ok(!('rpcUrl' in summary.near));
  });
});

describe('source guard', () => {
  it('never logs', () => {
    const source = fs.readFileSync(new URL('./nearConfig.js', import.meta.url), 'utf8');
    assert.ok(!/\bconsole\s*\./.test(source));
  });
});
