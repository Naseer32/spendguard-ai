import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_TOKEN, startTestServer } from './testing/httpKit.js';
import { MODULES } from './testing/testRoutes.js';

describe('JSON charset handling', () => {
  let t;
  before(async () => {
    t = await startTestServer({ routeModules: MODULES });
  });
  after(() => t.close());

  const send = (contentType) =>
    t.request('POST', '/api/test/echo', {
      token: OWNER_TOKEN,
      body: '{"a":1}',
      headers: { 'content-type': contentType },
    });

  it('accepts only UTF-8, in any case or quoted', async () => {
    const accepted = [
      'application/json',
      'application/json; charset=utf-8',
      'application/json; charset=UTF-8',
      'application/json;charset=utf-8',
      'application/json; charset="utf-8"',
      'application/json; charset=utf-8; boundary=x',
    ];
    for (const type of accepted) {
      assert.equal((await send(type)).status, 201, type);
    }
  });

  it('refuses every other charset', async () => {
    const refused = [
      'application/json; charset=utf-16',
      'application/json; charset=utf-16le',
      'application/json; charset=utf8',
      'application/json; charset=latin1',
      'application/json; charset=iso-8859-1',
      'application/json; charset=',
      'application/json; charset="utf-16"',
      'application/json; charset=utf-8x',
      'application/json; charset=utf-80',
    ];
    for (const type of refused) {
      const res = await send(type);
      assert.equal(res.status, 415, type);
      assert.equal(res.json.error.code, 'UNSUPPORTED_MEDIA_TYPE', type);
    }
  });
});
