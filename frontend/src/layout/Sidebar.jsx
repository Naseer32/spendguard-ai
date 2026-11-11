import { NavLink } from 'react-router-dom';
import { APP_INFO } from '../lib/appInfo.js';
import Brand from './Brand.jsx';
import { NAV_ITEMS } from './navItems.jsx';

/** Desktop sidebar (lg and up). Hidden on mobile, where MobileNav is used. */
export default function Sidebar() {
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
                      ? 'bg-accent-50 text-accent-700'
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

      <div className="border-t border-line px-5 py-4 text-xs text-ink-muted">
        <p className="font-medium text-ink-soft">{APP_INFO.build} · v{APP_INFO.version}</p>
        <p className="mt-0.5">Sample data only. No backend connection yet.</p>
      </div>
    </aside>
  );
}
