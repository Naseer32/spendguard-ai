import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRpcClient } from './rpcClient.js';
import {
  RpcHttpError,
  RpcNetworkError,
  RpcProtocolError,
  RpcRemoteError,
  RpcTimeoutError,
} from './rpcErrors.js';

async function startFake(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let json = null;
      try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json = null; }
      requests.push({ method: req.method, url: req.url, headers: req.headers, json });
      handler(req, res, json);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  if (Buffer.isBuffer(body) || typeof body === 'string') res.end(body);
  else res.end(JSON.stringify(body));
}

async function withFake(handler, fn) {
  const fake = await startFake(handler);
  try {
    return await fn(fake);
  } finally {
    await fake.close();
  }
}

const clientFor = (fake, over = {}) => createRpcClient({ url: fake.url, allowLoopbackHttp: true, ...over });
const echo = (req, res, json) => reply(res, 200, { jsonrpc: '2.0', id: json.id, result: { method: json.method, params: json.params } });

describe('successful calls', () => {
  it('sends a JSON-RPC 2.0 POST and returns the result', () =>
    withFake(
      (req, res, json) => reply(res, 200, { jsonrpc: '2.0', id: json.id, result: { answer: 42 } }),
      async (fake) => {
        const result = await clientFor(fake).call('some_method', { a: 1 });
        assert.deepEqual(result, { answer: 42 });
        const seen = fake.requests[0];
        assert.equal(seen.method, 'POST');
        assert.equal(seen.headers['content-type'], 'application/json');
        assert.equal(seen.json.jsonrpc, '2.0');
        assert.equal(seen.json.method, 'some_method');
        assert.deepEqual(seen.json.params, { a: 1 });
        assert.equal(typeof seen.json.id, 'string');
      },
    ));

  it('supports array params, and an empty array by default', () =>
    withFake(echo, async (fake) => {
      const client = clientFor(fake);
      assert.deepEqual((await client.call('m', ['x', 2])).params, ['x', 2]);
      assert.deepEqual((await client.call('m')).params, []);
      assert.deepEqual((await client.call('m', {})).params, {});
    }));

  it('returns falsy results as they are', () =>
    withFake(
      (req, res, json) => {
        const values = { nul: null, zero: 0, no: false, empty: '' };
        reply(res, 200, { jsonrpc: '2.0', id: json.id, result: values[json.method] });
      },
      async (fake) => {
        const client = clientFor(fake);
        assert.equal(await client.call('nul'), null);
        assert.equal(await client.call('zero'), 0);
        assert.equal(await client.call('no'), false);
        assert.equal(await client.call('empty'), '');
      },
    ));

  it('treats a null error field next to a result as success', () =>
    withFake((req, res) => reply(res, 200, { result: 7, error: null }), async (fake) => {
      assert.equal(await clientFor(fake).call('m'), 7);
    }));

  it('keeps calls independent when made concurrently', () =>
    withFake(echo, async (fake) => {
      const client = clientFor(fake);
      const results = await Promise.all([1, 2, 3, 4, 5].map((n) => client.call('m', { n })));
      assert.deepEqual(results.map((r) => r.params.n), [1, 2, 3, 4, 5]);
      const ids = new Set(fake.requests.map((r) => r.json.id));
      assert.equal(ids.size, 5);
    }));

  it('exposes only the host', () =>
    withFake(echo, async (fake) => {
      const client = createRpcClient({ url: `${fake.url}/v2/SECRET`, allowLoopbackHttp: true });
      assert.equal(client.host, `127.0.0.1:${fake.port}`);
    }));

  it('works over https through an injected fetch and forbids redirects', async () => {
    const seen = [];
    const client = createRpcClient({
      url: 'https://rpc.example.com/v2/abc',
      fetch: async (target, init) => {
        seen.push({ target, init });
        return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
      },
    });
    assert.equal(await client.call('m', ['a']), 'ok');
    assert.equal(seen[0].target, 'https://rpc.example.com/v2/abc');
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.redirect, 'error');
    assert.ok(seen[0].init.signal instanceof AbortSignal);
  });
});

describe('server errors', () => {
  it('turns a JSON-RPC error into RpcRemoteError with truncated details', () =>
    withFake(
      (req, res) => reply(res, 200, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'x'.repeat(300), data: 'details' } }),
      async (fake) => {
        await assert.rejects(clientFor(fake).call('m'), (error) => {
          assert.ok(error instanceof RpcRemoteError);
          assert.equal(error.code, 'RPC_REMOTE');
          assert.equal(error.retryable, false);
          assert.equal(error.message, 'RPC server returned an error');
          assert.equal(error.rpcCode, -32000);
          assert.equal(error.rpcMessage.length, 201);
          assert.ok(error.remote.includes('details'));
          assert.ok(error.remote.length <= 501);
          return true;
        });
      },
    ));

  it('copes with unusual error shapes', () =>
    withFake(
      (req, res, json) => {
        const errors = { text: 'plain text error', nocode: { message: 'only a message' }, odd: { code: 'x', message: 5 } };
        reply(res, 200, { error: errors[json.method] });
      },
      async (fake) => {
        const client = clientFor(fake);
        await assert.rejects(client.call('text'), (e) => e instanceof RpcRemoteError && e.rpcMessage === 'plain text error' && e.rpcCode === null);
        await assert.rejects(client.call('nocode'), (e) => e instanceof RpcRemoteError && e.rpcCode === null && e.rpcMessage === 'only a message');
        await assert.rejects(client.call('odd'), (e) => e instanceof RpcRemoteError && e.rpcCode === null && e.rpcMessage === null);
      },
    ));

  it('maps HTTP failures, and marks only transient ones as retryable', () =>
    withFake(
      (req, res, json) => reply(res, Number(json.method.slice(1)), { result: 'ignored' }),
      async (fake) => {
        const client = clientFor(fake);
        const expected = { 400: false, 401: false, 404: false, 429: true, 500: true, 502: true, 503: true, 504: true };
        for (const [status, retryable] of Object.entries(expected)) {
          await assert.rejects(client.call(`s${status}`), (error) => {
            assert.ok(error instanceof RpcHttpError, status);
            assert.equal(error.status, Number(status));
            assert.equal(error.retryable, retryable, status);
            assert.equal(error.code, 'RPC_HTTP');
            return true;
          });
        }
      },
    ));
});

describe('malformed responses', () => {
  it('rejects anything that is not a JSON-RPC result or error', () =>
    withFake(
      (req, res, json) => {
        const bodies = {
          text: 'not json', empty: '', array: '[]', string: '"text"', number: '42', nul: 'null',
          object: '{}', noresult: '{"jsonrpc":"2.0","id":1}', other: '{"foo":1}',
          badutf8: Buffer.from([0xff, 0xfe, 0xfd]),
        };
        reply(res, 200, bodies[json.method]);
      },
      async (fake) => {
        const client = clientFor(fake);
        for (const name of ['text', 'empty', 'array', 'string', 'number', 'nul', 'object', 'noresult', 'other', 'badutf8']) {
          await assert.rejects(client.call(name), (error) => {
            assert.ok(error instanceof RpcProtocolError, name);
            assert.equal(error.code, 'RPC_PROTOCOL');
            assert.equal(error.retryable, false);
            return true;
          }, name);
        }
      },
    ));
});

describe('response size cap', () => {
  const exact = (size) => {
    const pad = 'x'.repeat(size - '{"result":""}'.length);
    return { text: `{"result":"${pad}"}`, pad };
  };

  it('accepts a body of exactly the cap and refuses one byte more', () =>
    withFake(
      (req, res, json) => {
        const size = json.method === 'atcap' ? 1024 : 1025;
        const { text } = exact(size);
        reply(res, 200, text, { 'content-length': String(Buffer.byteLength(text)) });
      },
      async (fake) => {
        const client = clientFor(fake, { maxResponseBytes: 1024 });
        assert.equal((await client.call('atcap')).length, 1024 - '{"result":""}'.length);
        await assert.rejects(client.call('over'), (e) => e instanceof RpcProtocolError && e.detail === 'response too large');
      },
    ));

  it('refuses an oversized declared length before reading', () =>
    withFake(
      (req, res) => {
        const body = 'x'.repeat(2000);
        reply(res, 200, body, { 'content-length': '2000' });
      },
      async (fake) => {
        await assert.rejects(clientFor(fake, { maxResponseBytes: 1024 }).call('m'), (e) => e instanceof RpcProtocolError && e.detail === 'response too large');
      },
    ));

  it('stops an oversized chunked response with no declared length', () =>
    withFake(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        for (let i = 0; i < 3; i += 1) res.write('x'.repeat(600));
        res.end();
      },
      async (fake) => {
        await assert.rejects(clientFor(fake, { maxResponseBytes: 1024 }).call('m'), (e) => e instanceof RpcProtocolError && e.detail === 'response too large');
      },
    ));
});

describe('timeouts and network failures', () => {
  it('times out when the server never answers', () =>
    withFake(() => {}, async (fake) => {
      const started = Date.now();
      await assert.rejects(clientFor(fake, { timeoutMs: 150 }).call('m'), (error) => {
        assert.ok(error instanceof RpcTimeoutError);
        assert.equal(error.code, 'RPC_TIMEOUT');
        assert.equal(error.retryable, true);
        return true;
      });
      assert.ok(Date.now() - started < 3000);
    }));

  it('times out when the body stalls halfway', () =>
    withFake(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"result":');
      },
      async (fake) => {
        await assert.rejects(clientFor(fake, { timeoutMs: 150 }).call('m'), RpcTimeoutError);
      },
    ));

  it('does not time out a prompt answer', () =>
    withFake(echo, async (fake) => {
      assert.ok(await clientFor(fake, { timeoutMs: 150 }).call('m'));
    }));

  it('reports a refused connection as a retryable network error with a safe reason', async () => {
    const fake = await startFake(() => {});
    const { url } = fake;
    await fake.close();
    const client = createRpcClient({ url, allowLoopbackHttp: true, timeoutMs: 2000 });
    await assert.rejects(client.call('m'), (error) => {
      assert.ok(error instanceof RpcNetworkError);
      assert.equal(error.retryable, true);
      assert.match(error.reason, /^[A-Z0-9_]+$|^fetch_failed$/);
      return true;
    });
  });

  it('classifies failures raised by an injected fetch', async () => {
    const make = (thrower) => createRpcClient({ url: 'https://rpc.example.com', fetch: async () => { throw thrower; } });
    await assert.rejects(make(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })).call('m'),
      (e) => e instanceof RpcNetworkError && e.reason === 'ECONNRESET');
    await assert.rejects(make(new TypeError('fetch failed', { cause: { code: 'lower case!' } })).call('m'),
      (e) => e instanceof RpcNetworkError && e.reason === 'fetch_failed');
    await assert.rejects(make('a string').call('m'), (e) => e instanceof RpcNetworkError && e.reason === 'fetch_failed');
    await assert.rejects(make(null).call('m'), RpcNetworkError);
    await assert.rejects(make(new DOMException('t', 'TimeoutError')).call('m'), RpcTimeoutError);
    await assert.rejects(make(new DOMException('a', 'AbortError')).call('m'), RpcTimeoutError);
  });

  it('never follows a redirect', async () => {
    const target = await startFake((req, res) => reply(res, 200, { result: 'should not be reached' }));
    try {
      for (const status of [301, 302, 307, 308]) {
        await withFake(
          (req, res) => { res.writeHead(status, { location: `${target.url}/x` }); res.end(); },
          async (fake) => {
            await assert.rejects(clientFor(fake).call('m'), RpcNetworkError, String(status));
          },
        );
      }
      assert.equal(target.requests.length, 0);
    } finally {
      await target.close();
    }
  });
});

describe('secrets', () => {
  it('keeps the URL path and query out of every error', async () => {
    const secret = 'SECRET-API-KEY';
    await withFake(
      (req, res, json) => {
        if (json.method === 'hang') return;
        const variants = {
          http500: () => reply(res, 500, { result: 1 }),
          remote: () => reply(res, 200, { error: { code: -1, message: 'bad' } }),
          garbage: () => reply(res, 200, 'garbage'),
        };
        variants[json.method]();
      },
      async (fake) => {
        const client = createRpcClient({
          url: `${fake.url}/v2/${secret}?apikey=${secret}`, allowLoopbackHttp: true, timeoutMs: 150,
        });
        for (const method of ['http500', 'remote', 'garbage', 'hang']) {
          await assert.rejects(client.call(method), (error) => {
            const everything = `${error.message}${JSON.stringify(error)}${error.stack}${String(error)}`;
            assert.ok(!everything.includes(secret), method);
            return true;
          });
        }
        assert.equal(fake.requests[0].url, `/v2/${secret}?apikey=${secret}`); // the real request still used it
      },
    );
    const closed = await startFake(() => {});
    const closedUrl = `${closed.url}/v2/${secret}`;
    await closed.close();
    await assert.rejects(
      createRpcClient({ url: closedUrl, allowLoopbackHttp: true, timeoutMs: 2000 }).call('m'),
      (error) => !`${error.message}${JSON.stringify(error)}${error.stack}`.includes(secret),
    );
  });

  it('never logs and always refuses redirects', () => {
    const source = fs.readFileSync(new URL('./rpcClient.js', import.meta.url), 'utf8');
    assert.ok(!/\bconsole\s*\./.test(source));
    assert.ok(source.includes("redirect: 'error'"));
    assert.ok(source.includes('AbortSignal.timeout('));
  });
});

describe('arguments', () => {
  it('rejects invalid client options', () => {
    const ok = { url: 'https://rpc.example.com' };
    const bad = [
      undefined, null, 'x', 5, {}, { url: 'x' }, { url: 'http://rpc.example.com' },
      { url: 'http://127.0.0.1:1' }, { url: 'http://example.com', allowLoopbackHttp: true },
      { ...ok, timeoutMs: 0 }, { ...ok, timeoutMs: 60_001 }, { ...ok, timeoutMs: 1.5 }, { ...ok, timeoutMs: '5' },
      { ...ok, maxResponseBytes: 15 }, { ...ok, maxResponseBytes: 16_777_217 }, { ...ok, maxResponseBytes: 1.5 },
      { ...ok, fetch: 'x' }, { ...ok, allowLoopbackHttp: 'yes' }, { ...ok, extra: 1 },
    ];
    bad.forEach((options, i) => {
      assert.throws(() => createRpcClient(options), TypeError, `options #${i}`);
    });
    assert.doesNotThrow(() => createRpcClient(ok));
    assert.doesNotThrow(() => createRpcClient({ url: 'http://127.0.0.1:1', allowLoopbackHttp: true }));
  });

  it('rejects invalid method names and params', async () => {
    const client = createRpcClient({ url: 'https://rpc.example.com', fetch: async () => new Response('{"result":1}') });
    for (const method of ['', '1abc', 'a b', 'a-b', 'x'.repeat(65), 5, null, undefined]) {
      await assert.rejects(client.call(method), TypeError, String(method));
    }
    for (const params of ['x', 5, null, new Date(), new Map(), true]) {
      await assert.rejects(client.call('m', params), TypeError, String(params));
    }
    assert.equal(await client.call('valid_method_1'), 1);
  });
});
