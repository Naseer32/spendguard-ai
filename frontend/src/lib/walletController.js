// Wallet connection state, independent of React and of the wallet library.
// `loadAdapter` resolves an adapter: { network, init(), connect(), disconnect(), signTransfer(t), onAccountChange?(cb) }.
// The adapter never exposes keys or seed phrases; signing happens inside the wallet.

import { NEAR_NETWORK, describeWalletError, isAccountId } from './payTx.js';

const INITIAL = Object.freeze({ status: 'disconnected', accountId: null, error: null, network: NEAR_NETWORK });

export function createWalletController(loadAdapter) {
  let state = INITIAL;
  let adapterPromise = null;
  let initPromise = null;
  const listeners = new Set();

  const set = (patch) => {
    state = Object.freeze({ ...state, ...patch });
    for (const l of [...listeners]) l();
  };
  const applyAccount = (accountId) =>
    isAccountId(accountId)
      ? set({ status: 'connected', accountId, error: null })
      : set({ status: 'disconnected', accountId: null });

  const getAdapter = () => {
    adapterPromise ??= (async () => {
      const adapter = await loadAdapter();
      if (adapter?.network !== NEAR_NETWORK) throw new Error('Only NEAR Testnet is supported.');
      adapter.onAccountChange?.(applyAccount);
      return adapter;
    })().catch((error) => {
      adapterPromise = null;
      throw error;
    });
    return adapterPromise;
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Restore an existing wallet session, if any. Never throws. */
    init() {
      initPromise ??= (async () => {
        try {
          applyAccount(await (await getAdapter()).init());
        } catch {
          set({ status: 'disconnected', accountId: null });
        }
      })();
      return initPromise;
    },

    async connect() {
      if (state.status === 'connecting') return;
      set({ status: 'connecting', error: null });
      try {
        const accountId = await (await getAdapter()).connect();
        if (!isAccountId(accountId)) throw new Error('The wallet returned no account.');
        set({ status: 'connected', accountId, error: null });
      } catch (error) {
        const { kind } = describeWalletError(error);
        set({
          status: 'disconnected',
          accountId: null,
          error: kind === 'rejected' ? 'Connection cancelled in the wallet.' : 'Could not connect to the wallet: ' + String(error?.message ?? error).slice(0, 140),
        });
      }
    },

    /** Always ends disconnected, even if the wallet errors. */
    async disconnect() {
      set({ status: 'disconnected', accountId: null, error: null });
      try {
        await (await getAdapter()).disconnect();
      } catch {
        /* already disconnected here */
      }
    },

    async signTransfer(transfer) {
      if (state.status !== 'connected') throw new Error('Wallet is not connected.');
      return (await getAdapter()).signTransfer(transfer);
    },
  };
}
