import { NavLink } from 'react-router-dom';
import { APP_INFO } from '../lib/appInfo.js';
import { useStore } from '../state/DataStore.jsx';
import Brand from './Brand.jsx';
import { NAV_ITEMS } from './navItems.jsx';

/** Desktop sidebar (lg and up). Hidden on mobile, where MobileNav is used. */
export default function Sidebar() {
  const { isLive } = useStore();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-white lg:flex">
      <div className="flex h-16 items-center border-b border-line px-5">
        <Brand />
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Ic, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-50 text-accent-700 shadow-[inset_3px_0_0_var(--color-accent-600)]'
                      : 'text-ink-soft hover:bg-surface hover:text-ink'
                  }`
                }
              >
                <Ic className="h-5 w-5 shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="m-3 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink-muted">
        <p className="flex items-center gap-1.5 font-medium text-ink-soft"><span className={`h-2 w-2 rounded-full ${isLive ? 'bg-success-600' : 'bg-warning-600'}`} />{isLive ? 'Live' : APP_INFO.build} · v{APP_INFO.version}</p>
        <p className="mt-0.5">{isLive ? 'Connected to your backend. No wallet signing.' : 'Sample data only. Not connected to a backend.'}</p>
      </div>
    </aside>
  );
}
