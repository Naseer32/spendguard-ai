import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createWalletController } from '../lib/walletController.js';

// One wallet controller for the whole app. The wallet library is imported on first use, so it stays out of
// the initial bundle and demo mode never loads it. Wallet connection is separate from the backend
// connection: connecting a wallet never touches the owner token.

const controller = createWalletController(async () => (await import('../near/walletSelector.js')).createSelectorAdapter());

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.init();
  }, []);
  const value = useMemo(
    () => ({
      status: snapshot.status,
      accountId: snapshot.accountId,
      error: snapshot.error,
      network: snapshot.network,
      connect: controller.connect,
      disconnect: controller.disconnect,
      signTransfer: controller.signTransfer,
    }),
    [snapshot],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
