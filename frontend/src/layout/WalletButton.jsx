import Button from '../components/ui/Button.jsx';
import { WalletIcon } from '../components/ui/Icons.jsx';

// Reserved slot for NEAR Testnet wallet connection.
// F1 does not implement wallet connection or signing, so the control is
// disabled and says why. It never handles keys or seed phrases.
export default function WalletButton() {
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled
      title="Wallet connection is planned for a later stage"
      aria-label="Connect NEAR wallet (not available yet)"
    >
      <WalletIcon className="h-4 w-4" />
      <span className="hidden sm:inline">Connect wallet</span>
    </Button>
  );
}
