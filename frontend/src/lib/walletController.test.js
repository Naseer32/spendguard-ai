import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWalletController } from './walletController.js';

function fakeAdapter(over = {}) {
  const calls = { connect: 0, disconnect: 0, sign: [] };
  const adapter = {
    network: 'testnet',
    calls,
    emit: null,
    async init() { return over.restored ?? null; },
    async connect() { calls.connect += 1; if (over.connectError) throw over.connectError; return over.account ?? 'agent-src.testnet'; },
    async disconnect() { calls.disconnect += 1; if (over.disconnectError) throw over.disconnectError; },
    async signTransfer(t) { calls.sign.push(t); return { transaction: { hash: 'x' } }; },
    onAccountChange(cb) { adapter.emit = cb; },
  };
  return adapter;
}
const make = (adapter) => createWalletController(async () => adapter);

describe('wallet connection state', () => {
  it('starts disconnected on testnet', () => {
    const c = make(fakeAdapter());
    assert.deepEqual(c.getSnapshot(), { status: 'disconnected', accountId: null, error: null, network: 'testnet' });
  });
  it('connects and exposes the account id, notifying subscribers', async () => {
    const c = make(fakeAdapter());
    const seen = [];
    c.subscribe(() => seen.push(c.getSnapshot().status));
    await c.connect();
    assert.equal(c.getSnapshot().status, 'connected');
    assert.equal(c.getSnapshot().accountId, 'agent-src.testnet');
    assert.deepEqual(seen, ['connecting', 'connected']);
  });
  it('ignores a second connect while one is running', async () => {
    const a = fakeAdapter();
    const c = make(a);
    await Promise.all([c.connect(), c.connect()]);
    assert.equal(a.calls.connect, 1);
  });
  it('handles a wallet rejection and an unusable account safely', async () => {
    const rejected = make(fakeAdapter({ connectError: new Error('User rejected') }));
    await rejected.connect();
    assert.equal(rejected.getSnapshot().status, 'disconnected');
    assert.match(rejected.getSnapshot().error, /cancelled/i);
    const bad = make(fakeAdapter({ account: 'NOT VALID' }));
    await bad.connect();
    assert.equal(bad.getSnapshot().status, 'disconnected');
    assert.equal(bad.getSnapshot().accountId, null);
  });
  it('disconnects and always ends disconnected, even if the wallet errors', async () => {
    const a = fakeAdapter({ disconnectError: new Error('boom') });
    const c = make(a);
    await c.connect();
    await c.disconnect();
    assert.equal(c.getSnapshot().status, 'disconnected');
    assert.equal(c.getSnapshot().accountId, null);
    assert.equal(a.calls.disconnect, 1);
  });
  it('restores an existing session and follows account changes', async () => {
    const a = fakeAdapter({ restored: 'agent-src.testnet' });
    const c = make(a);
    await c.init();
    assert.equal(c.getSnapshot().accountId, 'agent-src.testnet');
    a.emit('other.testnet');
    assert.equal(c.getSnapshot().accountId, 'other.testnet');
    a.emit(null);
    assert.equal(c.getSnapshot().status, 'disconnected');
  });
  it('refuses any adapter that is not testnet', async () => {
    const c = make({ ...fakeAdapter(), network: 'mainnet' });
    await c.connect();
    assert.equal(c.getSnapshot().status, 'disconnected');
    await c.init();
    assert.equal(c.getSnapshot().accountId, null);
  });
  it('survives an adapter that fails to load', async () => {
    const c = createWalletController(async () => { throw new Error('chunk failed'); });
    await c.init();
    await c.connect();
    assert.equal(c.getSnapshot().status, 'disconnected');
    assert.ok(c.getSnapshot().error);
  });
  it('refuses to sign while disconnected and passes the transfer through when connected', async () => {
    const a = fakeAdapter();
    const c = make(a);
    await assert.rejects(c.signTransfer({ receiverId: 'm.testnet', deposit: '1' }), /not connected/);
    assert.equal(a.calls.sign.length, 0);
    await c.connect();
    await c.signTransfer({ receiverId: 'm.testnet', deposit: '1' });
    assert.deepEqual(a.calls.sign, [{ receiverId: 'm.testnet', deposit: '1' }]);
  });
});
