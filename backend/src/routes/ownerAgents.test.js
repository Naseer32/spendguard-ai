import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifyChain } from '../audit/auditChain.js';
import { nearToYocto as N } from '../money/yocto.js';
import { count } from '../testing/dbKit.js';
import { OWNER_TOKEN, startTestServer } from '../testing/httpKit.js';
import { agentInput, auditEvents } from '../testing/serviceKit.js';
import { HIGH_FAILURE_LIMIT, UUID } from '../testing/testRoutes.js';

const AGENT_KEYS = [
  'approvalThreshold', 'createdAt', 'dailyBudget', 'id', 'name',
  'perTxLimit', 'sourceAccount', 'status', 'updatedAt',
];
const RECIPIENT_KEYS = ['accountId', 'agentId', 'createdAt', 'id', 'listType', 'note'];
const KEY_RE =
  /^sgk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{64}$/;

describe('owner agent routes', () => {
  let t;
  let call;
  before(async () => {
    t = await startTestServer({ env: HIGH_FAILURE_LIMIT });
    call = (method, path, json) => t.request(method, path, { token: OWNER_TOKEN, json });
  });
  after(() => t.close());

  async function createOne(over = {}) {
    const res = await call('POST', '/api/agents', agentInput(over));
    assert.equal(res.status, 201);
    return res.json.data;
  }

  it('creates an agent and returns the API key once', async () => {
    const res = await call('POST', '/api/agents', agentInput({ name: 'First' }));
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.json.data).sort(), ['agent', 'apiKey']);
    const { agent, apiKey } = res.json.data;
    assert.match(apiKey, KEY_RE);
    assert.ok(apiKey.includes(agent.id));
    assert.deepEqual(Object.keys(agent).sort(), [...AGENT_KEYS].sort());
    assert.equal(agent.name, 'First');
    assert.equal(agent.status, 'ACTIVE');
    assert.equal(agent.dailyBudget, N('100'));
    const event = auditEvents(t.db).at(-1);
    assert.equal(event.event, 'AGENT_CREATED');
    assert.equal(event.actor, 'owner');
    assert.equal(event.entityId, agent.id);
  });

  it('never shows the key or its hash again', async () => {
    const { agent, apiKey } = await createOne({ name: 'Hidden key' });
    const hash = t.db.prepare('SELECT api_key_hash FROM agents WHERE id = ?').get(agent.id).api_key_hash;
    for (const path of ['/api/agents', `/api/agents/${agent.id}`]) {
      const res = await call('GET', path);
      assert.equal(res.status, 200);
      assert.ok(!res.text.includes(apiKey.slice(-64)), path);
      assert.ok(!res.text.includes(hash), path);
      assert.ok(!/api_?key/i.test(res.text), path);
    }
    const one = await call('GET', `/api/agents/${agent.id}`);
    assert.deepEqual(one.json.data.agent, agent);
    const list = await call('GET', '/api/agents');
    assert.ok(list.json.data.agents.some((a) => a.id === agent.id));
    for (const a of list.json.data.agents) {
      assert.deepEqual(Object.keys(a).sort(), [...AGENT_KEYS].sort());
    }
  });

  it('rejects malformed agents and creates nothing', async () => {
    const before = count(t.db, 'agents');
    const bad = [
      {}, agentInput({ name: '' }), agentInput({ sourceAccount: 'Bad Account' }),
      agentInput({ dailyBudget: '1.5' }), agentInput({ dailyBudget: 100 }),
      agentInput({ perTxLimit: N('200') }), agentInput({ approvalThreshold: N('50') }),
      { ...agentInput(), status: 'PAUSED' }, { ...agentInput(), apiKeyHash: 'x' },
    ];
    for (const json of bad) {
      const res = await call('POST', '/api/agents', json);
      assert.equal(res.status, 400, JSON.stringify(json));
      assert.equal(res.json.error.code, 'VALIDATION');
    }
    const arrayBody = await t.request('POST', '/api/agents', {
      token: OWNER_TOKEN, body: '[]', headers: { 'content-type': 'application/json' },
    });
    assert.equal(arrayBody.status, 400);
    assert.equal(count(t.db, 'agents'), before);
  });

  it('returns 404 for unknown agents and 400 for malformed ids', async () => {
    for (const [method, suffix, json] of [
      ['GET', '', undefined], ['PUT', '/limits', { dailyBudget: N('100') }], ['POST', '/pause', undefined],
      ['POST', '/resume', undefined], ['POST', '/rotate-key', undefined],
      ['GET', '/recipients', undefined], ['DELETE', '/recipients/shop.testnet', undefined],
      ['PUT', '/recipients/shop.testnet', { listType: 'ALLOW' }],
    ]) {
      const unknown = await call(method, `/api/agents/${UUID}${suffix}`, json);
      assert.equal(unknown.status, 404, `${method} ${suffix}`);
      assert.equal(unknown.json.error.code, 'NOT_FOUND');
      const malformed = await call(method, `/api/agents/not-an-id${suffix}`, json);
      assert.equal(malformed.status, 400, `${method} ${suffix}`);
    }
  });

  it('updates limits and validates the combination', async () => {
    const { agent } = await createOne({ name: 'Limits' });
    const res = await call('PUT', `/api/agents/${agent.id}/limits`, { dailyBudget: N('200') });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.agent.dailyBudget, N('200'));
    assert.equal(res.json.data.agent.perTxLimit, N('20'));
    const bad = [
      {}, { perTxLimit: N('4') }, { approvalThreshold: N('21') }, { perTxLimit: N('300') },
      { dailyBudget: '1.5' }, { dailyBudget: 5 }, { name: 'x' }, { status: 'PAUSED' },
    ];
    for (const json of bad) {
      const r = await call('PUT', `/api/agents/${agent.id}/limits`, json);
      assert.equal(r.status, 400, JSON.stringify(json));
    }
    const unchanged = await call('GET', `/api/agents/${agent.id}`);
    assert.equal(unchanged.json.data.agent.dailyBudget, N('200'));
    assert.equal(unchanged.json.data.agent.perTxLimit, N('20'));
    const plain = await t.request('PUT', `/api/agents/${agent.id}/limits`, {
      token: OWNER_TOKEN, body: '{}', headers: { 'content-type': 'text/plain' },
    });
    assert.equal(plain.status, 415);
  });

  it('pauses and resumes, and the policy follows', async () => {
    const { agent, apiKey } = await createOne({ name: 'Pausable' });
    await call('PUT', `/api/agents/${agent.id}/recipients/merchant.testnet`, { listType: 'ALLOW' });
    const evaluate = (key) =>
      t.request('POST', '/api/v1/payments/evaluate', {
        token: apiKey,
        json: { idempotencyKey: key, recipient: 'merchant.testnet', amount: N('1') },
      });

    assert.equal((await evaluate('pause-test-0001')).json.data.payment.status, 'APPROVED');
    const paused = await call('POST', `/api/agents/${agent.id}/pause`);
    assert.equal(paused.status, 200);
    assert.equal(paused.json.data.agent.status, 'PAUSED');
    const blocked = await evaluate('pause-test-0002');
    assert.equal(blocked.json.data.payment.status, 'BLOCKED');
    assert.deepEqual(blocked.json.data.payment.reasonCodes, ['AGENT_PAUSED']);
    assert.equal((await call('POST', `/api/agents/${agent.id}/pause`)).status, 200); // already paused
    const resumed = await call('POST', `/api/agents/${agent.id}/resume`);
    assert.equal(resumed.json.data.agent.status, 'ACTIVE');
    assert.equal((await evaluate('pause-test-0003')).json.data.payment.status, 'APPROVED');
  });

  it('rotates the key and invalidates the old one immediately', async () => {
    const { agent, apiKey: oldKey } = await createOne({ name: 'Rotating' });
    const probe = (key) => t.request('GET', `/api/v1/payments/${UUID}`, { token: key });
    assert.equal((await probe(oldKey)).status, 404); // authenticated, request not found

    const rotated = await call('POST', `/api/agents/${agent.id}/rotate-key`);
    assert.equal(rotated.status, 200);
    assert.deepEqual(Object.keys(rotated.json.data).sort(), ['agent', 'apiKey']);
    const newKey = rotated.json.data.apiKey;
    assert.match(newKey, KEY_RE);
    assert.notEqual(newKey, oldKey);
    assert.equal((await probe(oldKey)).status, 401);
    assert.equal((await probe(newKey)).status, 404);
    const read = await call('GET', `/api/agents/${agent.id}`);
    assert.ok(!read.text.includes(newKey.slice(-64)));
    assert.equal(auditEvents(t.db).at(-1).event, 'AGENT_KEY_ROTATED');
  });
});

describe('owner recipient routes', () => {
  let t;
  let call;
  let agentId;
  let apiKey;
  before(async () => {
    t = await startTestServer({ env: HIGH_FAILURE_LIMIT });
    call = (method, path, json) => t.request(method, path, { token: OWNER_TOKEN, json });
    const created = await call('POST', '/api/agents', agentInput({ name: 'Recipients' }));
    agentId = created.json.data.agent.id;
    apiKey = created.json.data.apiKey;
  });
  after(() => t.close());

  const base = () => `/api/agents/${agentId}/recipients`;
  const evaluateTo = (recipient, key) =>
    t.request('POST', '/api/v1/payments/evaluate', {
      token: apiKey,
      json: { idempotencyKey: key, recipient, amount: N('1') },
    });

  it('adds, lists, moves and removes recipients', async () => {
    const added = await call('PUT', `${base()}/shop.testnet`, { listType: 'ALLOW', note: 'Coffee' });
    assert.equal(added.status, 200);
    const recipient = added.json.data.recipient;
    assert.deepEqual(Object.keys(recipient).sort(), [...RECIPIENT_KEYS].sort());
    assert.equal(recipient.agentId, agentId);
    assert.equal(recipient.accountId, 'shop.testnet');
    assert.equal(recipient.listType, 'ALLOW');
    assert.equal(recipient.note, 'Coffee');

    const list = await call('GET', base());
    assert.deepEqual(list.json.data.recipients, [recipient]);

    const moved = await call('PUT', `${base()}/shop.testnet`, { listType: 'BLOCK' });
    assert.equal(moved.json.data.recipient.id, recipient.id);
    assert.equal(moved.json.data.recipient.listType, 'BLOCK');
    assert.equal(moved.json.data.recipient.note, null);

    assert.deepEqual((await call('GET', `${base()}?list=ALLOW`)).json.data.recipients, []);
    assert.equal((await call('GET', `${base()}?list=BLOCK`)).json.data.recipients.length, 1);

    const removed = await call('DELETE', `${base()}/shop.testnet`);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.data.recipient.id, recipient.id);
    assert.equal((await call('DELETE', `${base()}/shop.testnet`)).status, 404);
    assert.deepEqual((await call('GET', base())).json.data.recipients, []);
  });

  it('rejects bad recipient requests', async () => {
    const cases = [
      ['PUT', `${base()}/shop.testnet`, {}],
      ['PUT', `${base()}/shop.testnet`, { listType: 'MAYBE' }],
      ['PUT', `${base()}/shop.testnet`, { listType: 'allow' }],
      ['PUT', `${base()}/shop.testnet`, { listType: 'ALLOW', note: 5 }],
      ['PUT', `${base()}/shop.testnet`, { listType: 'ALLOW', accountId: 'other.testnet' }],
      ['PUT', `${base()}/shop.testnet`, { listType: 'ALLOW', agentId: UUID }],
      ['PUT', `${base()}/A.testnet`, { listType: 'ALLOW' }],
      ['PUT', `${base()}/a`, { listType: 'ALLOW' }],
      ['PUT', `${base()}/bad..name`, { listType: 'ALLOW' }],
      ['GET', `${base()}?list=MAYBE`, undefined],
      ['GET', `${base()}?other=1`, undefined],
    ];
    for (const [method, path, json] of cases) {
      const res = await call(method, path, json);
      assert.equal(res.status, 400, `${method} ${path} ${JSON.stringify(json)}`);
    }
    assert.deepEqual((await call('GET', base())).json.data.recipients, []);
  });

  it('feeds the policy: allowlisted pays, blocklisted is blocked, unknown needs approval', async () => {
    await call('PUT', `${base()}/good.testnet`, { listType: 'ALLOW' });
    await call('PUT', `${base()}/bad.testnet`, { listType: 'BLOCK' });
    const allowed = await evaluateTo('good.testnet', 'recipient-test-01');
    const blocked = await evaluateTo('bad.testnet', 'recipient-test-02');
    const unknown = await evaluateTo('new.testnet', 'recipient-test-03');
    assert.equal(allowed.json.data.payment.status, 'APPROVED');
    assert.equal(blocked.json.data.payment.status, 'BLOCKED');
    assert.deepEqual(blocked.json.data.payment.reasonCodes, ['RECIPIENT_BLOCKED']);
    assert.equal(unknown.json.data.payment.status, 'APPROVAL_REQUIRED');
  });
});

describe('owner audit trail', () => {
  it('records every owner action under the owner and keeps the chain valid', async () => {
    const t = await startTestServer({ env: HIGH_FAILURE_LIMIT });
    try {
      const call = (method, path, json) => t.request(method, path, { token: OWNER_TOKEN, json });
      const created = await call('POST', '/api/agents', agentInput({ name: 'Audited' }));
      const id = created.json.data.agent.id;
      await call('PUT', `/api/agents/${id}/limits`, { dailyBudget: N('150') });
      await call('POST', `/api/agents/${id}/pause`);
      await call('POST', `/api/agents/${id}/resume`);
      await call('POST', `/api/agents/${id}/rotate-key`);
      await call('PUT', `/api/agents/${id}/recipients/shop.testnet`, { listType: 'ALLOW' });
      await call('PUT', `/api/agents/${id}/recipients/shop.testnet`, { listType: 'BLOCK' });
      await call('DELETE', `/api/agents/${id}/recipients/shop.testnet`);

      const events = auditEvents(t.db);
      assert.deepEqual(events.map((e) => e.event), [
        'AGENT_CREATED', 'AGENT_LIMITS_UPDATED', 'AGENT_PAUSED', 'AGENT_RESUMED',
        'AGENT_KEY_ROTATED', 'RECIPIENT_ADDED', 'RECIPIENT_UPDATED', 'RECIPIENT_REMOVED',
      ]);
      assert.ok(events.every((e) => e.actor === 'owner'));
      assert.equal(verifyChain(t.db).valid, true);
      assert.ok(!JSON.stringify(events).includes('sgk_'));
    } finally {
      await t.close();
    }
  });
});
