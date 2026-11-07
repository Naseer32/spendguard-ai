import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../services/errors.js';
import {
  ACCESS,
  METHODS,
  PARAM_RULES,
  clientIp,
  isValidRoutePattern,
  paramNamesOf,
  readQuery,
  validateParams,
} from './routeKit.js';

const UUID = '0123abcd-0123-4abc-8def-0123456789ab';

describe('constants', () => {
  it('defines the access levels and methods', () => {
    assert.deepEqual({ ...ACCESS }, { PUBLIC: 'public', OWNER: 'owner', AGENT: 'agent' });
    assert.deepEqual([...METHODS], ['GET', 'POST', 'PUT', 'DELETE']);
    assert.ok(Object.isFrozen(ACCESS) && Object.isFrozen(METHODS) && Object.isFrozen(PARAM_RULES));
  });
});

describe('isValidRoutePattern', () => {
  it('accepts simple API paths', () => {
    for (const p of [
      '/api/health', '/api/v1/payments/evaluate', '/api/agents/:agentId',
      '/api/agents/:agentId/recipients/:accountId', '/api/a-b/c1',
    ]) {
      assert.equal(isValidRoutePattern(p), true, p);
    }
  });

  it('rejects anything else', () => {
    for (const p of [
      '/api', '/api/', 'api/x', '/api/Bad', '/api/x/', '/api//x', '/api/x/*', '/api/x/:',
      '/api/x/:1a', '/api/x?y=1', '/api/x/{a}', '/api/a b', '/other/x', '', '/api/x/(.*)',
      '/api/x/:a/:', 5, null, undefined,
    ]) {
      assert.equal(isValidRoutePattern(p), false, String(p));
    }
  });

  it('extracts parameter names in order', () => {
    assert.deepEqual(paramNamesOf('/api/health'), []);
    assert.deepEqual(paramNamesOf('/api/agents/:agentId/recipients/:accountId'), ['agentId', 'accountId']);
  });
});

describe('validateParams', () => {
  it('accepts valid ids and account names', () => {
    const out = validateParams({ agentId: UUID, accountId: 'shop.testnet', extra: 'ignored' }, ['agentId', 'accountId']);
    assert.deepEqual(out, { agentId: UUID, accountId: 'shop.testnet' });
    assert.deepEqual(validateParams({ requestId: UUID.toUpperCase() }, ['requestId']), { requestId: UUID.toUpperCase() });
    for (const accountId of ['ab', 'a-b_c.near', 'x'.repeat(64)]) {
      assert.equal(validateParams({ accountId }, ['accountId']).accountId, accountId);
    }
    assert.deepEqual(validateParams({}, []), {});
  });

  it('rejects invalid values with the parameter name', () => {
    const bad = [
      ['agentId', 'abc'], ['agentId', ''], ['agentId', `${UUID}x`], ['agentId', ` ${UUID}`],
      ['agentId', undefined], ['agentId', 5], ['requestId', '../etc/passwd'],
      ['accountId', 'a'], ['accountId', 'A.near'], ['accountId', 'a b'], ['accountId', 'x'.repeat(65)],
      ['accountId', ''], ['accountId', undefined], ['accountId', ['a.near']],
    ];
    for (const [name, value] of bad) {
      assert.throws(
        () => validateParams({ [name]: value }, [name]),
        (e) => e instanceof ValidationError && e.field === name,
        `${name}=${String(value)}`,
      );
    }
    assert.throws(() => validateParams(undefined, ['agentId']), ValidationError);
  });

  it('refuses parameters that have no rule', () => {
    assert.throws(() => validateParams({ other: 'x' }, ['other']), TypeError);
  });
});

describe('readQuery', () => {
  const spec = { limit: 'int', status: 'string' };

  it('reads integers and strings', () => {
    assert.deepEqual(readQuery({ limit: '5', status: 'APPROVED' }, spec), { limit: 5, status: 'APPROVED' });
    assert.deepEqual(readQuery({ limit: '0' }, spec), { limit: 0 });
    assert.deepEqual(readQuery({ limit: '999999999' }, spec), { limit: 999999999 });
    assert.deepEqual(readQuery({}, spec), {});
    assert.deepEqual(readQuery(undefined, spec), {});
    assert.deepEqual(readQuery(null, {}), {});
  });

  it('works with a null-prototype object', () => {
    const query = Object.assign(Object.create(null), { limit: '7' });
    assert.deepEqual(readQuery(query, spec), { limit: 7 });
  });

  it('rejects unknown parameters', () => {
    assert.throws(() => readQuery({ nope: '1' }, spec), (e) => e instanceof ValidationError && e.field === 'nope');
    assert.throws(() => readQuery({ limit: '1' }, {}), ValidationError);
    assert.throws(() => readQuery({ x: '1' }, { toString: 'string' }), ValidationError);
    assert.throws(() => readQuery({ toString: '1' }, spec), ValidationError);
  });

  it('rejects repeated, empty, oversized and malformed values', () => {
    const bad = [
      { limit: ['1', '2'] }, { status: ['A', 'B'] }, { limit: '' }, { status: '' },
      { limit: '01' }, { limit: '-1' }, { limit: '1.5' }, { limit: 'abc' }, { limit: '1000000000' },
      { limit: ' 5' }, { limit: '5 ' }, { limit: '1e3' }, { status: 'x'.repeat(129) },
      { limit: { a: '1' } },
    ];
    bad.forEach((query, i) => {
      assert.throws(() => readQuery(query, spec), ValidationError, `query #${i}`);
    });
    assert.deepEqual(readQuery({ status: 'x'.repeat(128) }, spec), { status: 'x'.repeat(128) });
  });
});

describe('clientIp', () => {
  it('uses the socket address and unwraps IPv4-mapped IPv6', () => {
    assert.equal(clientIp({ socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
    assert.equal(clientIp({ socket: { remoteAddress: '::ffff:10.0.0.5' } }), '10.0.0.5');
    assert.equal(clientIp({ socket: { remoteAddress: '::1' } }), '::1');
  });

  it('ignores proxy headers', () => {
    const req = { socket: { remoteAddress: '10.0.0.9' }, headers: { 'x-forwarded-for': '1.2.3.4' } };
    assert.equal(clientIp(req), '10.0.0.9');
  });

  it('falls back to "unknown"', () => {
    for (const req of [{}, { socket: null }, { socket: {} }, { socket: { remoteAddress: '' } }, { socket: { remoteAddress: 5 } }]) {
      assert.equal(clientIp(req), 'unknown');
    }
  });
});
