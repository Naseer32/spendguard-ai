import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { count } from '../testing/dbKit.js';
import { withServer } from '../testing/ownerKit.js';

const ENTRY_KEYS = ['actor', 'entityId', 'event', 'hash', 'payload', 'prevHash', 'seq', 'ts'];

// Six audit entries: agent created, recipient added, payment evaluated (by the
// agent), approved (by the owner), a second payment evaluated, then cancelled.
async function scenario(c) {
  const pending = await c.evaluate({ recipient: 'other.testnet' });
  c.clock.advance(1000);
  await c.owner('POST', `/api/payments/${pending.id}/approve`, { comment: 'fine' });
  const second = await c.evaluate();
  await c.owner('POST', `/api/payments/${second.id}/cancel`);
  return { pending, second };
}

describe('listing the audit log', () => {
  it('lists every entry oldest first with the actor of each action', () =>
    withServer(async (c) => {
      await scenario(c);
      const res = await c.owner('GET', '/api/audit');
      assert.equal(res.status, 200);
      const { entries, hasMore, nextAfterSeq, head } = res.json.data;
      assert.equal(entries.length, count(c.t.db, 'audit_log'));
      assert.deepEqual(entries.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
      assert.deepEqual(entries.map((e) => e.event), [
        'AGENT_CREATED', 'RECIPIENT_ADDED', 'PAYMENT_EVALUATED',
        'PAYMENT_APPROVED', 'PAYMENT_EVALUATED', 'PAYMENT_CANCELLED',
      ]);
      assert.deepEqual(entries.map((e) => e.actor), [
        'owner', 'owner', `agent:${c.agent.id}`, 'owner', `agent:${c.agent.id}`, 'owner',
      ]);
      for (const entry of entries) {
        assert.deepEqual(Object.keys(entry).sort(), [...ENTRY_KEYS].sort());
      }
      for (let i = 1; i < entries.length; i += 1) {
        assert.equal(entries[i].prevHash, entries[i - 1].hash);
      }
      assert.equal(hasMore, false);
      assert.equal(nextAfterSeq, 6);
      assert.deepEqual(head, { seq: 6, hash: entries[5].hash });
    }));

  it('pages with a cursor', () =>
    withServer(async (c) => {
      await scenario(c);
      const seen = [];
      let afterSeq = 0;
      const flags = [];
      for (let page = 0; page < 5; page += 1) {
        const res = await c.owner('GET', `/api/audit?limit=2&afterSeq=${afterSeq}`);
        assert.equal(res.status, 200);
        seen.push(...res.json.data.entries.map((e) => e.seq));
        flags.push(res.json.data.hasMore);
        afterSeq = res.json.data.nextAfterSeq;
        if (!res.json.data.hasMore) break;
      }
      assert.deepEqual(seen, [1, 2, 3, 4, 5, 6]);
      assert.deepEqual(flags, [true, true, false]);
      const past = await c.owner('GET', '/api/audit?afterSeq=6');
      assert.deepEqual(past.json.data.entries, []);
      assert.equal(past.json.data.nextAfterSeq, 6);
    }));

  it('filters by event and by entity', () =>
    withServer(async (c) => {
      const { pending } = await scenario(c);
      const byEvent = await c.owner('GET', '/api/audit?event=PAYMENT_EVALUATED');
      assert.deepEqual(byEvent.json.data.entries.map((e) => e.seq), [3, 5]);
      const byEntity = await c.owner('GET', `/api/audit?entityId=${pending.id}`);
      assert.deepEqual(byEntity.json.data.entries.map((e) => e.seq), [3, 4]);
      const none = await c.owner('GET', '/api/audit?event=NOPE');
      assert.deepEqual(none.json.data.entries, []);
    }));

  it('rejects bad parameters', () =>
    withServer(async (c) => {
      for (const bad of [
        '?afterSeq=-1', '?afterSeq=abc', '?afterSeq=', '?limit=0', '?limit=501', '?limit=abc',
        '?event=', '?entityId=', '?other=1', '?limit=1&limit=2',
      ]) {
        const res = await c.owner('GET', `/api/audit${bad}`);
        assert.equal(res.status, 400, bad);
        assert.equal(res.json.error.code, 'VALIDATION', bad);
      }
    }));

  it('shows the current head', () =>
    withServer(async (c) => {
      await scenario(c);
      const list = await c.owner('GET', '/api/audit');
      const head = await c.owner('GET', '/api/audit/head');
      assert.equal(head.status, 200);
      assert.deepEqual(head.json.data, { head: list.json.data.head });
      assert.equal(head.json.data.head.seq, 6);
    }));

  it('never contains API keys', () =>
    withServer(async (c) => {
      await scenario(c);
      const res = await c.owner('GET', '/api/audit?limit=500');
      assert.ok(!res.text.includes('sgk_'));
      assert.ok(!res.text.includes(c.apiKey.slice(-64)));
    }));
});

describe('verifying the audit log', () => {
  it('reports an intact chain', () =>
    withServer(async (c) => {
      await scenario(c);
      const res = await c.owner('GET', '/api/audit/verify');
      assert.equal(res.status, 200);
      const { verification } = res.json.data;
      assert.equal(verification.valid, true);
      assert.equal(verification.entries, 6);
      assert.equal(verification.headSeq, 6);
      assert.deepEqual(verification.problems, []);
    }));

  it('checks the head against a copy kept outside the database', () =>
    withServer(async (c) => {
      await scenario(c);
      const { head } = (await c.owner('GET', '/api/audit/head')).json.data;
      const matching = await c.owner('GET', `/api/audit/verify?expectedSeq=${head.seq}&expectedHash=${head.hash}`);
      assert.equal(matching.json.data.verification.valid, true);
      const mismatch = await c.owner('GET', `/api/audit/verify?expectedSeq=5&expectedHash=${'a'.repeat(64)}`);
      assert.equal(mismatch.status, 200);
      assert.equal(mismatch.json.data.verification.valid, false);
      assert.ok(mismatch.json.data.verification.problems.some((p) => p.code === 'HEAD_MISMATCH'));
    }));

  it('rejects incomplete or malformed expected heads', () =>
    withServer(async (c) => {
      for (const bad of [
        '?expectedSeq=1', `?expectedHash=${'a'.repeat(64)}`, '?expectedSeq=1&expectedHash=short',
        `?expectedSeq=1&expectedHash=${'A'.repeat(64)}`, `?expectedSeq=abc&expectedHash=${'a'.repeat(64)}`,
        '?other=1',
      ]) {
        const res = await c.owner('GET', `/api/audit/verify${bad}`);
        assert.equal(res.status, 400, bad);
        assert.equal(res.json.error.code, 'VALIDATION', bad);
      }
    }));

  it('detects tampering with the database file', () =>
    withServer(async (c) => {
      await scenario(c);
      c.t.db.exec('DROP TRIGGER audit_log_no_update');
      c.t.db.exec("UPDATE audit_log SET actor = 'evil' WHERE seq = 4");
      const res = await c.owner('GET', '/api/audit/verify');
      assert.equal(res.status, 200);
      const { verification } = res.json.data;
      assert.equal(verification.valid, false);
      assert.deepEqual(verification.problems.map((p) => [p.seq, p.code]), [[4, 'HASH_MISMATCH']]);
      const list = await c.owner('GET', '/api/audit');
      assert.equal(list.status, 200); // listing still works
    }));
});
