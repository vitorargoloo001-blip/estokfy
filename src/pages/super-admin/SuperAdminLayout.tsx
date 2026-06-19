import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import { useSuperAdmin } from '@/hooks/useSuperAdmin';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, Store, LogOut, Shield, Menu, Boxes, KeyRound, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

import { CreditCard } from 'lucide-react';

const navItems = [
  { to: '/super-admin', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/super-admin/stores', icon: Store, label: 'Lojas' },
  { to: '/super-admin/modules', icon: Boxes, label: 'Licenças de Módulos' },
  { to: '/super-admin/connect/licenses', icon: KeyRound, label: 'Licenças Connect' },
  { to: '/super-admin/financeiro', icon: DollarSign, label: 'Financeiro Impetus' },
  { to: '/super-admin/payment-verifications', icon: CreditCard, label: 'Pagamentos' },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { signOut } = useAuth();
  return (
    <>
      {navItems.map(n => (
        <Link key={n.to} to={n.to} onClick={onNavigate}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            (pathname === n.to || (n.to !== '/super-admin' && pathname.startsWith(n.to)))
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent text-muted-foreground hover:text-foreground'
          )}>
          <n.icon className="h-4 w-4" />
          {n.label}
        </Link>
      ))}
      <div className="mt-auto space-y-2">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
          <Store className="h-4 w-4" />Voltar ao sistema
        </Link>
        <button onClick={() => signOut()} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground w-full">
          <LogOut className="h-4 w-4" />Sair
        </button>
      </div>
    </>
  );
}

export default function SuperAdminLayout() {
  const { isSuperAdmin, loading } = useSuperAdmin();
  const { loading: authLoading } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isSuperAdmin) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-card border-r p-4 gap-2 fixed h-full">
        <div className="flex items-center gap-2 mb-6 px-2">
          <Shield className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg">Super Admin</span>
        </div>
        <NavLinks pathname={location.pathname} />
      </aside>

      {/* Mobile header + sheet */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-card border-b flex items-center px-3 gap-3">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon"><Menu className="h-5 w-5" /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 mb-6 px-2">
              <Shield className="h-6 w-6 text-primary" />
              <span className="font-bold text-lg">Super Admin</span>
            </div>
            <NavLinks pathname={location.pathname} onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <Shield className="h-5 w-5 text-primary" />
        <span className="font-semibold">Super Admin</span>
      </div>

      <main className="flex-1 md:ml-64 p-4 md:p-6 pt-[72px] md:pt-6">
        <Outlet />
      </main>
    </div>
  );
}
