import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import AppSidebar from './AppSidebar';
import MobileNav from './MobileNav';
import MobileFAB from './MobileFAB';
import TopBar from './TopBar';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import PageTip from './PageTip';

// Lazy: chat IA não precisa estar no bundle inicial
const AISupportChat = lazy(() => import('./AISupportChat'));

export default function AppLayout() {
  useKeyboardShortcuts();

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      <main className="flex-1 md:ml-64 p-4 md:p-8 pb-24 md:pb-8 w-full min-w-0 overflow-x-hidden">
        <TopBar />
        <PageTip />
        <Outlet />
      </main>

      {/* Mobile navigation */}
      <MobileNav />
      <MobileFAB />
      <Suspense fallback={null}>
        <AISupportChat />
      </Suspense>
    </div>
  );
}
