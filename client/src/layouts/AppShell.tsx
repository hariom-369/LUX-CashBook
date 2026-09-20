import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { MobileNavDrawer } from './MobileNavDrawer';
import { LoadingState } from '../components/ui/States';
import { CommandPalette } from '../components/CommandPalette';

/**
 * The authenticated application frame.
 *
 * Desktop: fixed sidebar + sticky top bar.
 * Mobile:  top bar + bottom bar, with the full navigation behind a drawer.
 *
 * The bottom padding on small screens is what stops the last transaction row from
 * hiding behind the bottom bar — an easy thing to forget and an obvious one to
 * notice.
 */
export function AppShell() {
  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Visually hidden until focused — the first tab stop for a keyboard user,
          letting them skip the nav and land straight in the page content. */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[80] focus-visible:rounded-md focus-visible:bg-ink focus-visible:px-4 focus-visible:py-2.5 focus-visible:text-sm focus-visible:font-medium focus-visible:text-ink-inverse"
      >
        Skip to content
      </a>

      <Sidebar />
      <MobileNavDrawer />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-5 outline-none sm:px-6 sm:pt-6 lg:pb-10"
        >
          <Suspense fallback={<LoadingState rows={4} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <BottomNav />
      <CommandPalette />
    </div>
  );
}
