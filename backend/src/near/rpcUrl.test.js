import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRpcUrl } from './rpcUrl.js';

describe('parseRpcUrl', () => {
  it('accepts https URLs, including paths and queries', () => {
    for (const value of [
      'https://rpc.testnet.near.org',
      'https://rpc.example.com/v2/abc123',
      'https://rpc.example.com:8443/path?key=value',
      'https://localhost',
    ]) {
      assert.equal(parseRpcUrl(value) instanceof URL, true, value);
    }
    assert.equal(parseRpcUrl('https://rpc.example.com/v2/abc').host, 'rpc.example.com');
  });

  it('rejects plain http, other schemes and malformed values', () => {
    const bad = [
      'http://rpc.testnet.near.org', 'http://127.0.0.1:3000', 'ftp://rpc.example.com',
      'file:///etc/passwd', 'javascript:alert(1)', 'ws://rpc.example.com', 'rpc.example.com',
      '//rpc.example.com', '', ' ', 'not a url', 'https://', 'https:///path', 'https:\\\\rpc.example.com', 'https:/rpc.example.com',
      ' https://rpc.example.com', 'https://rpc.example.com ', 'https://rpc .example.com',
      `https://${'a'.repeat(2050)}.com`, undefined, null, 5, {}, [],
    ];
    for (const value of bad) {
      assert.throws(() => parseRpcUrl(value), (e) => e instanceof TypeError && e.message === 'invalid RPC URL', String(value));
    }
  });

  it('rejects credentials and fragments', () => {
    for (const value of [
      'https://user:pass@rpc.example.com', 'https://user@rpc.example.com', 'https://:pass@rpc.example.com',
      'https://rpc.example.com/#frag', 'https://rpc.example.com/path#frag',
    ]) {
      assert.throws(() => parseRpcUrl(value), TypeError, value);
    }
  });

  it('accepts plain http only for loopback hosts and only when explicitly allowed', () => {
    for (const value of ['http://127.0.0.1:8080', 'http://localhost:8080/x', 'http://[::1]:8080']) {
      assert.throws(() => parseRpcUrl(value), TypeError, value);
      assert.throws(() => parseRpcUrl(value, { allowLoopbackHttp: false }), TypeError, value);
      assert.equal(parseRpcUrl(value, { allowLoopbackHttp: true }) instanceof URL, true, value);
    }
    for (const value of ['http://example.com', 'http://192.168.1.5:8080', 'http://127.0.0.1.evil.com', 'http://localhost.evil.com']) {
      assert.throws(() => parseRpcUrl(value, { allowLoopbackHttp: true }), TypeError, value);
    }
    assert.throws(() => parseRpcUrl('http://127.0.0.1', { allowLoopbackHttp: 'yes' }), TypeError);
  });

  it('never puts the URL in the error message', () => {
    for (const value of ['http://rpc.example.com/SECRET-KEY', 'https://user:SECRETPASS@rpc.example.com']) {
      try {
        parseRpcUrl(value);
        assert.fail('expected a throw');
      } catch (error) {
        assert.ok(!error.message.includes('SECRET'));
      }
    }
  });
});
