import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar.jsx';
import Topbar from '../components/layout/Topbar.jsx';
import MobileNav from '../components/layout/MobileNav.jsx';
import Drawer from '../components/ui/Drawer.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import ErrorBoundary from '../components/common/ErrorBoundary.jsx';
import { NotificationProvider } from '../context/NotificationContext.jsx';

/**
 * Authenticated shell. Desktop (lg+): fixed sidebar. Phones/tablets: top bar + bottom tab bar,
 * with the full navigation in a slide-in drawer. Pages render in <Outlet/> (lazy, with Suspense).
 */
export default function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);

  return (
    <NotificationProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-contrast">Skip to content</a>
      <div className="min-h-screen lg:pl-64">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border bg-surface lg:block"><Sidebar /></aside>
        <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width="sm" bare title="Menu" className="!max-w-[18rem]">
          <Sidebar onNavigate={() => setNavOpen(false)} />
        </Drawer>
        <Topbar onMenuClick={() => setNavOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:py-8">
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<div className="flex justify-center py-24"><Spinner className="h-7 w-7" /></div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
        <MobileNav onMore={() => setNavOpen(true)} />
      </div>
    </NotificationProvider>
  );
}
