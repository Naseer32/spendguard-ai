import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLatestAudit, loadOlderAudit, mergeAudit, loadSnapshot, upsertById } from './loaders.js';

// Fake audit backend with `total` entries, ascending, cursor = afterSeq.
function fakeAudit(total) {
  const calls = [];
  return {
    calls,
    listAudit: async ({ afterSeq = 0, limit = 100 }) => {
      calls.push({ afterSeq, limit });
      const entries = [];
      for (let s = afterSeq + 1; s <= total && entries.length < limit; s++) entries.push({ seq: s });
      return { entries, hasMore: false, nextAfterSeq: afterSeq, headSeq: total };
    },
  };
}

test('latest audit: empty log', async () => {
  const r = await loadLatestAudit(fakeAudit(0));
  assert.deepEqual(r, { entries: [], hasOlder: false, headSeq: 0 });
});

test('latest audit: small log is returned whole', async () => {
  const r = await loadLatestAudit(fakeAudit(5), 200);
  assert.deepEqual(r.entries.map((e) => e.seq), [1, 2, 3, 4, 5]);
  assert.equal(r.hasOlder, false);
});

test('latest audit: long log returns the newest window and says there is more', async () => {
  const r = await loadLatestAudit(fakeAudit(1000), 200);
  assert.equal(r.entries.length, 200);
  assert.equal(r.entries[0].seq, 801);
  assert.equal(r.entries.at(-1).seq, 1000);
  assert.equal(r.hasOlder, true);
  assert.equal(r.headSeq, 1000);
});

test('older audit pages back without gaps or overlap', async () => {
  const api = fakeAudit(1000);
  const first = await loadLatestAudit(api, 200);
  const older = await loadOlderAudit(api, first.entries[0].seq, 200);
  assert.deepEqual([older.entries[0].seq, older.entries.at(-1).seq], [601, 800]);
  assert.equal(older.hasOlder, true);
  const all = mergeAudit(first.entries, older.entries);
  assert.equal(all.length, 400);
  all.forEach((e, i) => assert.equal(e.seq, 601 + i));
});

test('older audit stops at the start of the log', async () => {
  const api = fakeAudit(250);
  const first = await loadLatestAudit(api, 200);
  assert.equal(first.entries[0].seq, 51);
  const older = await loadOlderAudit(api, 51, 200);
  assert.equal(older.entries.length, 50);
  assert.equal(older.hasOlder, false);
  assert.deepEqual(await loadOlderAudit(api, 1, 200), { entries: [], hasOlder: false });
});

test('older audit never asks for more than the backend allows', async () => {
  const api = fakeAudit(5000);
  await loadOlderAudit(api, 5000, 500);
  assert.ok(api.calls.every((c) => c.limit <= 500));
});

test('mergeAudit dedupes by seq and sorts', () => {
  assert.deepEqual(mergeAudit([{ seq: 3 }, { seq: 1 }], [{ seq: 2 }, { seq: 3, x: 1 }]), [{ seq: 1 }, { seq: 2 }, { seq: 3, x: 1 }]);
});

test('snapshot loads agents, requests and audit; flags a full payments page', async () => {
  const api = { ...fakeAudit(3), listAgents: async () => [{ id: 'a' }], listPayments: async () => Array.from({ length: 200 }, (_, i) => ({ id: String(i) })) };
  const s = await loadSnapshot(api);
  assert.equal(s.agents.length, 1);
  assert.equal(s.requestsTruncated, true);
  assert.equal(s.audit.length, 3);
});

test('snapshot fails as a whole if any part fails', async () => {
  const api = { ...fakeAudit(3), listAgents: async () => { throw new Error('boom'); }, listPayments: async () => [] };
  await assert.rejects(loadSnapshot(api), /boom/);
});

test('upsertById replaces or appends without mutating', () => {
  const list = [{ id: 'a', v: 1 }];
  assert.deepEqual(upsertById(list, { id: 'a', v: 2 }), [{ id: 'a', v: 2 }]);
  assert.deepEqual(upsertById(list, { id: 'b' }), [{ id: 'a', v: 1 }, { id: 'b' }]);
  assert.equal(list[0].v, 1);
});
