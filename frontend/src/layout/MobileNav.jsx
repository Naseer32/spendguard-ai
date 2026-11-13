import { NavLink } from 'react-router-dom';
import { TAB_ITEMS } from './navItems.jsx';

/**
 * Bottom tab bar for phones and small tablets (below lg).
 * Thumb-reachable, 5 equal tabs, 56px touch targets, respects the Android
 * gesture-navigation safe area.
 */
export default function MobileNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-14px_rgb(11_31_58/0.3)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {TAB_ITEMS.map(({ to, shortLabel, icon: Ic, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors ${
                  isActive ? 'text-accent-700' : 'text-ink-muted active:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span className="absolute inset-x-4 top-0 h-0.5 rounded-b bg-accent-600" />
                  ) : null}
                  <Ic className="h-6 w-6" />
                  <span className="max-w-full truncate">{shortLabel}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
