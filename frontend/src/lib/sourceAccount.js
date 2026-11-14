// Which NEAR account an agent is created with.
//
// When a wallet is connected, its account IS the agent's source account: the owner signs payments
// from that account, and the backend only accepts a report whose signer equals it. Pure and
// unit-tested; no React, no network.

import { isAccountId } from './payTx.js';

/**
 * @param {{ walletStatus?: string, walletAccountId?: string|null, typed?: string }} input
 * @returns {{ account: string, fromWallet: boolean }}
 */
export function resolveSourceAccount({ walletStatus, walletAccountId, typed = '' } = {}) {
  if (walletStatus === 'connected' && isAccountId(walletAccountId)) {
    return { account: walletAccountId, fromWallet: true };
  }
  return { account: typeof typed === 'string' ? typed : '', fromWallet: false };
}
