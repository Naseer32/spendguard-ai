// The ONLY file that talks to NEAR Wallet Selector. Everything else uses the adapter shape below,
// so a change in the library only touches this file. Loaded lazily (dynamic import) by state/Wallet.jsx.
//
// NEAR Testnet only. No keys or seed phrases are ever requested or stored by this app: signing happens
// inside the wallet. Wallets that leave the page and come back (full-page redirect) are NOT enabled,
// because the owner token lives in memory only and would be lost; use wallets that return the result
// to the page (popup or extension).
//
// Adapter: { network, init() -> accountId|null, connect() -> accountId, disconnect(),
//            signTransfer({ receiverId, deposit }) -> FinalExecutionOutcome, onAccountChange(cb) }

import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';

const NETWORK = 'testnet';
const WALLET_ID = 'meteor-wallet';

export async function createSelectorAdapter() {
  const selector = await setupWalletSelector({ network: NETWORK, modules: [setupMeteorWallet()] });
  const activeAccount = () => selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null;

  return {
    network: NETWORK,

    async init() {
      return selector.isSignedIn() ? activeAccount() : null;
    },

    async connect() {
      const wallet = await selector.wallet(WALLET_ID);
      await wallet.signIn({}); // sign-in only: no contract, no function-call key
      return activeAccount();
    },

    async disconnect() {
      if (!selector.isSignedIn()) return;
      const wallet = await selector.wallet();
      await wallet.signOut();
    },

    // Plain NEAR transfer to the approved recipient. signerId pins the connected account.
    async signTransfer({ receiverId, deposit }) {
      const wallet = await selector.wallet();
      return wallet.signAndSendTransaction({
        signerId: activeAccount() ?? undefined,
        receiverId,
        actions: [{ type: 'Transfer', params: { deposit } }],
      });
    },

    onAccountChange(callback) {
      const subscription = selector.store.observable.subscribe(() => callback(activeAccount()));
      return () => subscription.unsubscribe();
    },
  };
}
