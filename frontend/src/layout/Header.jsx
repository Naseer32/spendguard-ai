import { Link, useLocation } from 'react-router-dom';
import { SettingsIcon } from '../components/ui/Icons.jsx';
import Brand from './Brand.jsx';
import NetworkStatus from './NetworkStatus.jsx';
import WalletButton from './WalletButton.jsx';
import { NAV_ITEMS } from './navItems.jsx';

/** Top bar: brand on mobile, section name on desktop, wallet/network on the right. */
export default function Header() {
  const { pathname } = useLocation();
  const current = NAV_ITEMS.find((i) =>
    i.end ? pathname === i.to : pathname.startsWith(i.to),
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
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
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft hover:bg-surface lg:hidden"
          >
            <SettingsIcon className="h-5 w-5" />
          </Link>
        </div>
      </div>
      {/* Always visible: nothing in this build is real data. */}
      <div className="border-t border-warning-200 bg-warning-50 px-4 py-1 text-center text-[11px] font-medium text-warning-700 sm:px-6 lg:px-8">
        Demo mode: sample data only. Not connected to the backend or NEAR Testnet.
      </div>
    </header>
  );
}
