import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyChain } from '../audit/auditChain.js';
import { T, count, describeBackends } from '../testing/dbKit.js';
import { NOW, auditEvents, seedAgent, svc } from '../testing/serviceKit.js';
import { NotFoundError, ValidationError } from './errors.js';
import {
  getRecipientLists,
  listRecipients,
  removeRecipient,
  setRecipient,
} from './recipients.js';

const VIEW_KEYS = ['accountId', 'agentId', 'createdAt', 'id', 'listType', 'note'];
const lastEvent = (db) => auditEvents(db).at(-1);

describeBackends('recipients', (ctx) => {
  function setup() {
    const db = ctx.open();
    const { agent } = seedAgent(db);
    return { db, agentId: agent.id };
  }

  it('adds a recipient and audits it', () => {
    const { db, agentId } = setup();
    const view = setRecipient(db, agentId, { accountId: 'shop.testnet', listType: 'ALLOW', note: 'Coffee shop' }, svc());
    assert.deepEqual(Object.keys(view).sort(), VIEW_KEYS);
    assert.equal(view.agentId, agentId);
    assert.equal(view.accountId, 'shop.testnet');
    assert.equal(view.listType, 'ALLOW');
    assert.equal(view.note, 'Coffee shop');
    assert.equal(view.createdAt, T);
    const event = lastEvent(db);
    assert.equal(event.event, 'RECIPIENT_ADDED');
    assert.equal(event.entityId, view.id);
    assert.deepEqual(event.payload, { agentId, accountId: 'shop.testnet', listType: 'ALLOW' });
    assert.equal(verifyChain(db).valid, true);
  });

  it('reports list membership in the shape the policy engine expects', () => {
    const { db, agentId } = setup();
    setRecipient(db, agentId, { accountId: 'good.testnet', listType: 'ALLOW' }, svc());
    setRecipient(db, agentId, { accountId: 'bad.testnet', listType: 'BLOCK' }, svc());
    assert.deepEqual({ ...getRecipientLists(db, agentId, 'good.testnet') }, { onAllowlist: true, onBlocklist: false });
    assert.deepEqual({ ...getRecipientLists(db, agentId, 'bad.testnet') }, { onAllowlist: false, onBlocklist: true });
    assert.deepEqual({ ...getRecipientLists(db, agentId, 'new.testnet') }, { onAllowlist: false, onBlocklist: false });
    assert.deepEqual({ ...getRecipientLists(db, agentId, undefined) }, { onAllowlist: false, onBlocklist: false });
    assert.deepEqual({ ...getRecipientLists(db, undefined, 'good.testnet') }, { onAllowlist: false, onBlocklist: false });
    assert.ok(Object.isFrozen(getRecipientLists(db, agentId, 'good.testnet')));
  });

  it('keeps lists separate between agents', () => {
    const { db, agentId } = setup();
    const other = seedAgent(db, { name: 'Other' }).agent.id;
    setRecipient(db, agentId, { accountId: 'shop.testnet', listType: 'ALLOW' }, svc());
    setRecipient(db, other, { accountId: 'shop.testnet', listType: 'BLOCK' }, svc());
    assert.equal(getRecipientLists(db, agentId, 'shop.testnet').onAllowlist, true);
    assert.equal(getRecipientLists(db, other, 'shop.testnet').onBlocklist, true);
    assert.equal(getRecipientLists(db, other, 'shop.testnet').onAllowlist, false);
  });

  it('moves a recipient between lists without creating a second row', () => {
    const { db, agentId } = setup();
    const first = setRecipient(db, agentId, { accountId: 'shop.testnet', listType: 'ALLOW' }, svc());
    const moved = setRecipient(db, agentId, { accountId: 'shop.testnet', listType: 'BLOCK' }, svc({ now: NOW + 1000 }));
    assert.equal(moved.id, first.id);
    assert.equal(moved.listType, 'BLOCK');
    assert.equal(moved.createdAt, T);
    assert.equal(count(db, 'recipients'), 1);
    const lists = getRecipientLists(db, agentId, 'shop.testnet');
    assert.equal(lists.onBlocklist, true);
    assert.equal(lists.onAllowlist, false);
    const event = lastEvent(db);
    assert.equal(event.event, 'RECIPIENT_UPDATED');
    assert.deepEqual(event.payload, { agentId, accountId: 'shop.testnet', from: 'ALLOW', to: 'BLOCK' });
  });

  it('trims notes, clears empty ones and clears the note when omitted', () => {
    const { db, agentId } = setup();
    const a = setRecipient(db, agentId, { accountId: 'a.testnet', listType: 'ALLOW', note: '  hello  ' }, svc());
    assert.equal(a.note, 'hello');
    const b = setRecipient(db, agentId, { accountId: 'b.testnet', listType: 'ALLOW', note: '   ' }, svc());
    assert.equal(b.note, null);
    const cleared = setRecipient(db, agentId, { accountId: 'a.testnet', listType: 'ALLOW' }, svc());
    assert.equal(cleared.note, null);
  });

  it('does not put notes in the audit log', () => {
    const { db, agentId } = setup();
    setRecipient(db, agentId, { accountId: 'a.testnet', listType: 'ALLOW', note: 'private note text' }, svc());
    assert.ok(!JSON.stringify(auditEvents(db)).includes('private note text'));
  });

  it('rejects invalid input and writes nothing', () => {
    const { db, agentId } = setup();
    const ok = { accountId: 'shop.testnet', listType: 'ALLOW' };
    const bad = [
      null, undefined, 'x', [], 5,
      { ...ok, accountId: undefined }, { ...ok, accountId: null }, { ...ok, accountId: 5 },
      { ...ok, accountId: '' }, { ...ok, accountId: 'A.testnet' }, { ...ok, accountId: 'a' },
      { ...ok, accountId: 'a b' }, { ...ok, accountId: 'x'.repeat(65) },
      { ...ok, listType: undefined }, { ...ok, listType: 'allow' }, { ...ok, listType: 'MAYBE' },
      { ...ok, listType: '' }, { ...ok, listType: null }, { ...ok, listType: 5 },
      { ...ok, note: 'x'.repeat(501) }, { ...ok, note: 'bad\u0000note' }, { ...ok, note: 5 },
      { ...ok, note: {} }, { ...ok, extra: 1 }, { ...ok, id: 'forced-id' },
    ];
    bad.forEach((input, i) => {
      assert.throws(() => setRecipient(db, agentId, input, svc()), ValidationError, `input #${i}`);
    });
    assert.equal(count(db, 'recipients'), 0);
    assert.equal(auditEvents(db).length, 1); // only AGENT_CREATED
  });

  it('fails for unknown agents', () => {
    const { db } = setup();
    for (const id of [randomUUID(), undefined, null, 5]) {
      assert.throws(
        () => setRecipient(db, id, { accountId: 'shop.testnet', listType: 'ALLOW' }, svc()),
        NotFoundError,
      );
    }
    assert.equal(count(db, 'recipients'), 0);
  });

  it('rejects an invalid context', () => {
    const { db, agentId } = setup();
    const input = { accountId: 'shop.testnet', listType: 'ALLOW' };
    for (const context of [undefined, {}, { now: 1.5, actor: 'o' }, { now: NOW, actor: '' }]) {
      assert.throws(() => setRecipient(db, agentId, input, context), TypeError);
    }
    assert.throws(() => removeRecipient(db, agentId, 'shop.testnet', undefined), TypeError);
    assert.equal(count(db, 'recipients'), 0);
  });

  it('removes a recipient and audits it', () => {
    const { db, agentId } = setup();
    const added = setRecipient(db, agentId, { accountId: 'shop.testnet', listType: 'BLOCK' }, svc());
    const removed = removeRecipient(db, agentId, 'shop.testnet', svc());
    assert.equal(removed.id, added.id);
    assert.equal(removed.listType, 'BLOCK');
    assert.equal(count(db, 'recipients'), 0);
    assert.equal(getRecipientLists(db, agentId, 'shop.testnet').onBlocklist, false);
    const event = lastEvent(db);
    assert.equal(event.event, 'RECIPIENT_REMOVED');
    assert.deepEqual(event.payload, { agentId, accountId: 'shop.testnet', listType: 'BLOCK' });
  });

  it('fails to remove unknown recipients', () => {
    const { db, agentId } = setup();
    assert.throws(() => removeRecipient(db, agentId, 'nobody.testnet', svc()), NotFoundError);
    assert.throws(() => removeRecipient(db, randomUUID(), 'nobody.testnet', svc()), NotFoundError);
    assert.throws(() => removeRecipient(db, agentId, undefined, svc()), NotFoundError);
    assert.throws(() => removeRecipient(db, undefined, 'nobody.testnet', svc()), NotFoundError);
  });

  it('lists recipients ordered by account id, optionally by list', () => {
    const { db, agentId } = setup();
    setRecipient(db, agentId, { accountId: 'b.testnet', listType: 'ALLOW' }, svc());
    setRecipient(db, agentId, { accountId: 'c.testnet', listType: 'BLOCK' }, svc());
    setRecipient(db, agentId, { accountId: 'a.testnet', listType: 'ALLOW' }, svc());
    assert.deepEqual(listRecipients(db, agentId).map((r) => r.accountId), ['a.testnet', 'b.testnet', 'c.testnet']);
    assert.deepEqual(listRecipients(db, agentId, 'ALLOW').map((r) => r.accountId), ['a.testnet', 'b.testnet']);
    assert.deepEqual(listRecipients(db, agentId, 'BLOCK').map((r) => r.accountId), ['c.testnet']);
    for (const view of listRecipients(db, agentId)) {
      assert.deepEqual(Object.keys(view).sort(), VIEW_KEYS);
    }
  });

  it('rejects bad list filters and unknown agents when listing', () => {
    const { db, agentId } = setup();
    assert.throws(() => listRecipients(db, agentId, 'MAYBE'), ValidationError);
    assert.throws(() => listRecipients(db, agentId, 'allow'), ValidationError);
    assert.throws(() => listRecipients(db, randomUUID()), NotFoundError);
    assert.throws(() => listRecipients(db, undefined), NotFoundError);
  });

  it('changes nothing when the audit append fails', () => {
    const { db, agentId } = setup();
    setRecipient(db, agentId, { accountId: 'shop.testnet', listType: 'ALLOW' }, svc());
    db.exec('DROP TABLE audit_log');
    assert.throws(
      () => setRecipient(db, agentId, { accountId: 'new.testnet', listType: 'ALLOW' }, svc()),
      /no such table/i,
    );
    assert.throws(
      () => setRecipient(db, agentId, { accountId: 'shop.testnet', listType: 'BLOCK' }, svc()),
      /no such table/i,
    );
    assert.throws(() => removeRecipient(db, agentId, 'shop.testnet', svc()), /no such table/i);
    assert.equal(count(db, 'recipients'), 1);
    assert.equal(getRecipientLists(db, agentId, 'shop.testnet').onAllowlist, true);
    assert.equal(db.isTransaction, false);
  });

  it('keeps the audit chain valid', () => {
    const { db, agentId } = setup();
    setRecipient(db, agentId, { accountId: 'a.testnet', listType: 'ALLOW' }, svc());
    setRecipient(db, agentId, { accountId: 'a.testnet', listType: 'BLOCK' }, svc());
    removeRecipient(db, agentId, 'a.testnet', svc());
    const result = verifyChain(db);
    assert.equal(result.valid, true);
    assert.equal(result.entries, 4);
  });
});
