import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { verifyChain } from '../audit/auditChain.js';
import { nearToYocto as N } from '../money/yocto.js';
import { T, count, describeBackends } from '../testing/dbKit.js';
import { NOW, agentInput, auditEvents, seedAgent, svc, tableText } from '../testing/serviceKit.js';
import {
  authenticateAgent,
  createAgent,
  getAgent,
  listAgents,
  pauseAgent,
  resumeAgent,
  rotateApiKey,
  updateLimits,
} from './agents.js';
import { NotFoundError, ValidationError } from './errors.js';

const KEY_FORMAT =
  /^sgk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{64}$/;
const VIEW_KEYS = [
  'approvalThreshold', 'createdAt', 'dailyBudget', 'id', 'name',
  'perTxLimit', 'sourceAccount', 'status', 'updatedAt',
];
const TABLES = [
  'agents', 'recipients', 'payment_requests', 'budget_reservations',
  'approvals', 'transactions', 'audit_log',
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// The full key and its secret must be in no table. The hash may exist only in agents.
function assertNoSecrets(db, apiKey) {
  const secret = apiKey.slice(-64);
  const hash = sha256(apiKey);
  for (const table of TABLES) {
    const text = tableText(db, table);
    assert.ok(!text.includes(apiKey), `${table} contains the full key`);
    assert.ok(!text.includes(secret), `${table} contains the key secret`);
    if (table !== 'agents') {
      assert.ok(!text.includes(hash), `${table} contains the key hash`);
    }
  }
}

const lastEvent = (db) => auditEvents(db).at(-1);

describe('agent source guard', () => {
  const source = fs.readFileSync(new URL('./agents.js', import.meta.url), 'utf8');

  it('compares key hashes in constant time', () => {
    assert.ok(source.includes('timingSafeEqual('));
  });

  it('never logs', () => {
    assert.ok(!/\bconsole\s*\./.test(source));
  });
});

describeBackends('agents: creation', (ctx) => {
  it('creates an agent and returns the key once', () => {
    const db = ctx.open();
    const { agent, apiKey } = seedAgent(db);
    assert.match(apiKey, KEY_FORMAT);
    assert.ok(apiKey.includes(agent.id));
    assert.deepEqual(Object.keys(agent).sort(), VIEW_KEYS);
    assert.equal(agent.name, 'Test Agent');
    assert.equal(agent.status, 'ACTIVE');
    assert.equal(agent.sourceAccount, 'owner.testnet');
    assert.equal(agent.dailyBudget, N('100'));
    assert.equal(agent.perTxLimit, N('20'));
    assert.equal(agent.approvalThreshold, N('5'));
    assert.equal(agent.createdAt, T);
    assert.equal(agent.updatedAt, T);
    const row = db.prepare('SELECT api_key_hash FROM agents WHERE id = ?').get(agent.id);
    assert.equal(row.api_key_hash, sha256(apiKey));
    assert.ok(!JSON.stringify(agent).includes(apiKey.slice(-64)));
    assert.ok(!JSON.stringify(agent).includes(row.api_key_hash));
  });

  it('never stores the key or exposes the hash outside the agents table', () => {
    const db = ctx.open();
    const { apiKey } = seedAgent(db);
    assertNoSecrets(db, apiKey);
  });

  it('writes one audit entry without secrets', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const events = auditEvents(db);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'AGENT_CREATED');
    assert.equal(events[0].actor, 'owner');
    assert.equal(events[0].entityId, agent.id);
    assert.deepEqual(events[0].payload, {
      name: 'Test Agent',
      sourceAccount: 'owner.testnet',
      dailyBudget: N('100'),
      perTxLimit: N('20'),
      approvalThreshold: N('5'),
    });
    assert.equal(verifyChain(db).valid, true);
  });

  it('trims the name and gives every agent its own id and key', () => {
    const db = ctx.open();
    const a = seedAgent(db, { name: '  Bot A  ' });
    const b = seedAgent(db, { name: 'Bot B' });
    assert.equal(a.agent.name, 'Bot A');
    assert.notEqual(a.agent.id, b.agent.id);
    assert.notEqual(a.apiKey, b.apiKey);
  });

  it('accepts zero limits and numerically ordered limits', () => {
    const db = ctx.open();
    seedAgent(db, { dailyBudget: '0', perTxLimit: '0', approvalThreshold: '0' });
    seedAgent(db, { dailyBudget: '100', perTxLimit: '10', approvalThreshold: '9' });
    assert.equal(count(db, 'agents'), 2);
  });

  it('rejects invalid input and writes nothing', () => {
    const db = ctx.open();
    const missing = (key) => {
      const input = agentInput();
      delete input[key];
      return input;
    };
    const bad = [
      null, undefined, 'x', [], 5,
      agentInput({ name: '' }), agentInput({ name: '   ' }), agentInput({ name: 5 }),
      agentInput({ name: 'x'.repeat(101) }), agentInput({ name: 'bad\u0000name' }),
      agentInput({ sourceAccount: '' }), agentInput({ sourceAccount: 'A.testnet' }),
      agentInput({ sourceAccount: 'a' }), agentInput({ sourceAccount: 5 }),
      agentInput({ dailyBudget: '1.5' }), agentInput({ dailyBudget: '-1' }),
      agentInput({ dailyBudget: 100 }), agentInput({ perTxLimit: '01' }),
      agentInput({ approvalThreshold: 'abc' }),
      agentInput({ perTxLimit: N('20'), approvalThreshold: N('21') }),
      agentInput({ dailyBudget: N('10'), perTxLimit: N('20') }),
      agentInput({ perTxLimit: '9', approvalThreshold: '10' }), // numeric, not text, comparison
      agentInput({ status: 'PAUSED' }), agentInput({ apiKeyHash: 'a'.repeat(64) }),
      missing('name'), missing('sourceAccount'), missing('dailyBudget'),
      missing('perTxLimit'), missing('approvalThreshold'),
    ];
    bad.forEach((input, i) => {
      assert.throws(() => createAgent(db, input, svc()), ValidationError, `input #${i}`);
    });
    assert.equal(count(db, 'agents'), 0);
    assert.equal(count(db, 'audit_log'), 0);
  });

  it('rejects an invalid context before touching the database', () => {
    const db = ctx.open();
    const bad = [
      undefined, {}, { now: NOW }, { actor: 'owner' }, { now: 1.5, actor: 'owner' },
      { now: '5', actor: 'owner' }, { now: NOW, actor: '' }, { now: NOW, actor: 'x'.repeat(129) },
    ];
    bad.forEach((context, i) => {
      assert.throws(() => createAgent(db, agentInput(), context), TypeError, `context #${i}`);
    });
    assert.equal(count(db, 'agents'), 0);
  });

  it('creates nothing when the audit append fails', () => {
    const db = ctx.open();
    db.exec('DROP TABLE audit_log');
    assert.throws(() => seedAgent(db), /no such table/i);
    assert.equal(count(db, 'agents'), 0);
    assert.equal(db.isTransaction, false);
  });
});

describeBackends('agents: authentication', (ctx) => {
  it('accepts the correct key', () => {
    const db = ctx.open();
    const { agent, apiKey } = seedAgent(db);
    const found = authenticateAgent(db, apiKey);
    assert.equal(found.id, agent.id);
    assert.deepEqual(Object.keys(found).sort(), VIEW_KEYS);
  });

  it('rejects wrong, mismatched and malformed keys', () => {
    const db = ctx.open();
    const a = seedAgent(db, { name: 'A' });
    const b = seedAgent(db, { name: 'B' });
    const secretA = a.apiKey.slice(-64);
    const flipped = a.apiKey.slice(0, -1) + (a.apiKey.endsWith('0') ? '1' : '0');
    const bad = [
      flipped,
      `sgk_${b.agent.id}_${secretA}`, // another agent's id with this secret
      `sgk_${randomUUID()}_${secretA}`, // unknown agent id
      b.apiKey.replace(b.agent.id, a.agent.id), // swapped id
      '', 'sgk_', a.apiKey.toUpperCase(), `${a.apiKey}x`, ` ${a.apiKey}`,
      a.apiKey.slice(1), a.agent.id, secretA, 'x'.repeat(10000),
      null, undefined, 5, {}, [a.apiKey],
    ];
    bad.forEach((key, i) => {
      assert.equal(authenticateAgent(db, key), null, `key #${i}`);
    });
    assert.notEqual(authenticateAgent(db, a.apiKey), null);
    assert.notEqual(authenticateAgent(db, b.apiKey), null);
  });

  it('still authenticates a paused agent and reports the status', () => {
    const db = ctx.open();
    const { agent, apiKey } = seedAgent(db);
    pauseAgent(db, agent.id, svc());
    assert.equal(authenticateAgent(db, apiKey).status, 'PAUSED');
  });
});

describeBackends('agents: key rotation', (ctx) => {
  it('issues a new key and invalidates the old one immediately', () => {
    const db = ctx.open();
    const { agent, apiKey: oldKey } = seedAgent(db);
    const rotated = rotateApiKey(db, agent.id, svc({ now: NOW + 60000 }));
    assert.match(rotated.apiKey, KEY_FORMAT);
    assert.notEqual(rotated.apiKey, oldKey);
    assert.ok(rotated.apiKey.includes(agent.id));
    assert.deepEqual(Object.keys(rotated.agent).sort(), VIEW_KEYS);
    assert.equal(authenticateAgent(db, oldKey), null);
    assert.equal(authenticateAgent(db, rotated.apiKey).id, agent.id);
    assert.equal(rotated.agent.createdAt, T);
    assert.equal(rotated.agent.updatedAt, '2026-11-04T12:01:00.000Z');
    assert.ok(!tableText(db, 'agents').includes(sha256(oldKey)));
    assertNoSecrets(db, oldKey);
    assertNoSecrets(db, rotated.apiKey);
  });

  it('audits the rotation without any key material', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    rotateApiKey(db, agent.id, svc());
    const event = lastEvent(db);
    assert.equal(event.event, 'AGENT_KEY_ROTATED');
    assert.equal(event.entityId, agent.id);
    assert.deepEqual(event.payload, {});
    assert.equal(verifyChain(db).valid, true);
  });

  it('invalidates every earlier key across repeated rotations', () => {
    const db = ctx.open();
    const first = seedAgent(db);
    const second = rotateApiKey(db, first.agent.id, svc());
    const third = rotateApiKey(db, first.agent.id, svc());
    assert.equal(authenticateAgent(db, first.apiKey), null);
    assert.equal(authenticateAgent(db, second.apiKey), null);
    assert.notEqual(authenticateAgent(db, third.apiKey), null);
  });

  it('does not touch other agents', () => {
    const db = ctx.open();
    const a = seedAgent(db, { name: 'A' });
    const b = seedAgent(db, { name: 'B' });
    rotateApiKey(db, a.agent.id, svc());
    assert.notEqual(authenticateAgent(db, b.apiKey), null);
  });

  it('fails for unknown agents', () => {
    const db = ctx.open();
    for (const id of [randomUUID(), 'nope', undefined, null, 5]) {
      assert.throws(() => rotateApiKey(db, id, svc()), NotFoundError);
    }
    assert.equal(count(db, 'audit_log'), 0);
  });

  it('keeps the old key valid when the audit append fails', () => {
    const db = ctx.open();
    const { agent, apiKey } = seedAgent(db);
    db.exec('DROP TABLE audit_log');
    assert.throws(() => rotateApiKey(db, agent.id, svc()), /no such table/i);
    assert.notEqual(authenticateAgent(db, apiKey), null);
    assert.equal(db.isTransaction, false);
  });
});

describeBackends('agents: limits', (ctx) => {
  it('updates a subset of limits and audits before and after', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const updated = updateLimits(db, agent.id, { dailyBudget: N('200') }, svc({ now: NOW + 1000 }));
    assert.equal(updated.dailyBudget, N('200'));
    assert.equal(updated.perTxLimit, N('20'));
    assert.equal(updated.approvalThreshold, N('5'));
    assert.equal(updated.createdAt, T);
    assert.equal(updated.updatedAt, '2026-11-04T12:00:01.000Z');
    const event = lastEvent(db);
    assert.equal(event.event, 'AGENT_LIMITS_UPDATED');
    assert.equal(event.entityId, agent.id);
    assert.deepEqual(event.payload.before, {
      dailyBudget: N('100'), perTxLimit: N('20'), approvalThreshold: N('5'),
    });
    assert.deepEqual(event.payload.after, {
      dailyBudget: N('200'), perTxLimit: N('20'), approvalThreshold: N('5'),
    });
    assert.equal(verifyChain(db).valid, true);
  });

  it('allows lowering or raising limits together', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const lowered = updateLimits(db, agent.id, { perTxLimit: N('4'), approvalThreshold: N('4') }, svc());
    assert.equal(lowered.perTxLimit, N('4'));
    const raised = updateLimits(db, agent.id, { dailyBudget: N('500'), perTxLimit: N('300') }, svc());
    assert.equal(raised.dailyBudget, N('500'));
    assert.equal(raised.perTxLimit, N('300'));
  });

  it('keeps large amounts exact', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const big = '9007199254740993';
    const updated = updateLimits(db, agent.id, { dailyBudget: big, perTxLimit: big, approvalThreshold: '5' }, svc());
    assert.equal(updated.dailyBudget, big);
  });

  it('rejects combinations that break threshold <= per-tx limit <= daily budget', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const bad = [
      { perTxLimit: N('4') }, // below the existing threshold of 5
      { approvalThreshold: N('21') }, // above the per-tx limit of 20
      { perTxLimit: N('101') }, // above the daily budget of 100
      { dailyBudget: N('19') }, // below the per-tx limit
    ];
    for (const changes of bad) {
      assert.throws(() => updateLimits(db, agent.id, changes, svc()), ValidationError, JSON.stringify(changes));
    }
    const unchanged = getAgent(db, agent.id);
    assert.equal(unchanged.dailyBudget, N('100'));
    assert.equal(unchanged.perTxLimit, N('20'));
    assert.equal(unchanged.approvalThreshold, N('5'));
    assert.equal(auditEvents(db).length, 1); // only AGENT_CREATED
  });

  it('rejects empty, unknown and malformed changes', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const bad = [
      {}, null, undefined, 'x', [], { status: 'PAUSED' }, { name: 'x' },
      { dailyBudget: '1.5' }, { dailyBudget: 100 }, { perTxLimit: '-1' },
    ];
    bad.forEach((changes, i) => {
      assert.throws(() => updateLimits(db, agent.id, changes, svc()), ValidationError, `changes #${i}`);
    });
  });

  it('fails for unknown agents', () => {
    const db = ctx.open();
    for (const id of [randomUUID(), undefined, 5]) {
      assert.throws(() => updateLimits(db, id, { dailyBudget: '1' }, svc()), NotFoundError);
    }
  });

  it('leaves limits unchanged when the audit append fails', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    db.exec('DROP TABLE audit_log');
    assert.throws(() => updateLimits(db, agent.id, { dailyBudget: N('200') }, svc()), /no such table/i);
    assert.equal(getAgent(db, agent.id).dailyBudget, N('100'));
  });
});

describeBackends('agents: pause, resume and lookup', (ctx) => {
  it('pauses and resumes with audit entries', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const paused = pauseAgent(db, agent.id, svc({ now: NOW + 1000 }));
    assert.equal(paused.status, 'PAUSED');
    assert.equal(paused.updatedAt, '2026-11-04T12:00:01.000Z');
    assert.deepEqual(lastEvent(db).payload, { from: 'ACTIVE', to: 'PAUSED' });
    assert.equal(lastEvent(db).event, 'AGENT_PAUSED');
    const resumed = resumeAgent(db, agent.id, svc({ now: NOW + 2000 }));
    assert.equal(resumed.status, 'ACTIVE');
    assert.equal(lastEvent(db).event, 'AGENT_RESUMED');
    assert.deepEqual(lastEvent(db).payload, { from: 'PAUSED', to: 'ACTIVE' });
  });

  it('does nothing and audits nothing when already in that state', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    const same = resumeAgent(db, agent.id, svc({ now: NOW + 5000 }));
    assert.equal(same.status, 'ACTIVE');
    assert.equal(same.updatedAt, T);
    pauseAgent(db, agent.id, svc());
    const before = auditEvents(db).length;
    const again = pauseAgent(db, agent.id, svc({ now: NOW + 9000 }));
    assert.equal(again.status, 'PAUSED');
    assert.equal(auditEvents(db).length, before);
  });

  it('fails for unknown agents', () => {
    const db = ctx.open();
    assert.throws(() => pauseAgent(db, randomUUID(), svc()), NotFoundError);
    assert.throws(() => resumeAgent(db, 'nope', svc()), NotFoundError);
    assert.throws(() => getAgent(db, randomUUID()), NotFoundError);
    for (const id of [undefined, null, 5]) {
      assert.throws(() => getAgent(db, id), NotFoundError);
    }
  });

  it('returns agents in creation order without key material', () => {
    const db = ctx.open();
    seedAgent(db, { name: 'A' }, svc({ now: NOW }));
    seedAgent(db, { name: 'B' }, svc({ now: NOW + 1000 }));
    seedAgent(db, { name: 'C' }, svc({ now: NOW + 2000 }));
    const list = listAgents(db);
    assert.deepEqual(list.map((a) => a.name), ['A', 'B', 'C']);
    for (const agent of list) {
      assert.deepEqual(Object.keys(agent).sort(), VIEW_KEYS);
    }
  });

  it('orders agents created at the same instant by id', () => {
    const db = ctx.open();
    for (const name of ['A', 'B', 'C', 'D']) seedAgent(db, { name });
    const ids = listAgents(db).map((a) => a.id);
    assert.deepEqual(ids, [...ids].sort());
  });

  it('keeps the audit chain valid across every operation', () => {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    updateLimits(db, agent.id, { dailyBudget: N('200') }, svc());
    pauseAgent(db, agent.id, svc());
    resumeAgent(db, agent.id, svc());
    rotateApiKey(db, agent.id, svc());
    const result = verifyChain(db);
    assert.equal(result.valid, true);
    assert.equal(result.entries, 5);
  });
});
