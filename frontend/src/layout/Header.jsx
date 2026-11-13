import { Link, useLocation } from 'react-router-dom';
import { SettingsIcon } from '../components/ui/Icons.jsx';
import { useStore } from '../state/DataStore.jsx';
import Brand from './Brand.jsx';
import NetworkStatus from './NetworkStatus.jsx';
import WalletButton from './WalletButton.jsx';
import { NAV_ITEMS } from './navItems.jsx';

/** Top bar: brand on mobile, section name on desktop, wallet/network on the right. */
export default function Header() {
  const { pathname } = useLocation();
  const { isLive, connection } = useStore();
  const current = NAV_ITEMS.find((i) =>
    i.end ? pathname === i.to : pathname.startsWith(i.to),
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 pt-[env(safe-area-inset-top)] shadow-[0_1px_0_rgb(11_31_58/0.02)] backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
        <Brand className="lg:hidden" />
        <p className="hidden text-sm font-medium text-ink-muted lg:block">
          {current ? current.label : 'SpendGuard AI'}
        </p>

        <div className="flex items-center gap-2">
          <NetworkStatus />
          <WalletButton />
          <Link
            to="/settings"
            aria-label="Settings"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft hover:bg-surface active:bg-surface-strong lg:hidden"
          >
            <SettingsIcon className="h-5 w-5" />
          </Link>
        </div>
      </div>
      {/* Always visible: says whether the data on screen is sample data or from the backend. */}
      {isLive ? (
        <div
          role="status"
          className="border-t border-success-200 bg-success-50 px-4 py-1.5 text-center text-[11px] font-medium leading-snug text-success-700 sm:text-xs sm:px-6 lg:px-8"
        >
          Live: connected to {connection.baseUrl || 'this server'}. Payments are signed in your NEAR Testnet wallet and verified by the backend.
        </div>
      ) : (
        <div className="border-t border-warning-200 bg-warning-50 px-4 py-1.5 text-center text-[11px] font-medium leading-snug text-warning-700 sm:text-xs sm:px-6 lg:px-8">
          Demo mode: sample data only. Not connected to the backend or NEAR Testnet.
        </div>
      )}
    </header>
  );
}
