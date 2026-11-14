import { Outlet } from 'react-router-dom';
import Button from '../components/ui/Button.jsx';
import { useStore } from '../state/DataStore.jsx';
import { useSettings } from '../state/Settings.jsx';
import Header from './Header.jsx';
import MobileNav from './MobileNav.jsx';
import Sidebar from './Sidebar.jsx';

function PreviewNotice() {
  const { previewState, setPreviewState } = useSettings();
  const { isLive } = useStore();
  if (previewState === 'normal' || isLive) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent-100 bg-accent-50 px-4 py-2 text-sm text-accent-700 sm:px-6 lg:px-8">
      <p>
        Simulating the <strong className="font-semibold">{previewState}</strong> state on list pages (demo tool).
      </p>
      <Button size="sm" onClick={() => setPreviewState('normal')}>Back to normal</Button>
    </div>
  );
}

export default function AppLayout() {
  return (
    <div className="min-h-dvh bg-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-card"
      >
        Skip to content
      </a>

      <Sidebar />

      <div className="flex min-h-dvh flex-col lg:pl-64">
        <Header />
        <PreviewNotice />
        {/* Bottom padding keeps content clear of the mobile tab bar. */}
        <main
          id="main"
          className="flex-1 bg-surface bg-[linear-gradient(to_bottom,var(--color-accent-50),var(--color-surface)_380px)] pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0"
        >
          <Outlet />
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
