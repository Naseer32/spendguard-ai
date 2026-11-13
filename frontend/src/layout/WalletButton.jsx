import Button from '../components/ui/Button.jsx';
import { WalletIcon } from '../components/ui/Icons.jsx';
import { useWallet } from '../state/Wallet.jsx';

// NEAR Testnet wallet connection. It only ever shows the public account ID. The app never asks for,
// reads or stores keys or seed phrases: signing happens inside the wallet.
export default function WalletButton() {
  const { status, accountId, error, connect, disconnect } = useWallet();

  if (status === 'connected') {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={disconnect}
        title={`NEAR Testnet wallet ${accountId}. Click to disconnect.`}
        aria-label={`Disconnect NEAR testnet wallet ${accountId}`}
      >
        <WalletIcon className="h-4 w-4" />
        <span className="max-w-[9rem] truncate font-mono text-xs sm:max-w-[14rem] sm:text-sm">{accountId}</span>
        <span className="hidden sm:inline">· Disconnect</span>
      </Button>
    );
  }

  const connecting = status === 'connecting';
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={connecting}
      onClick={connect}
      title={error ?? 'Connect a NEAR Testnet wallet'}
      aria-label="Connect NEAR testnet wallet"
    >
      <WalletIcon className="h-4 w-4" />
      <span className="hidden sm:inline">{connecting ? 'Connecting…' : 'Connect wallet'}</span>
    </Button>
  );
}
