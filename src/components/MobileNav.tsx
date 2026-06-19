import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutDashboard, Package, ShoppingCart, Boxes, DollarSign, Menu, X, Tag, Clock, Shield, Zap, Download, Wallet } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useSuperAdmin } from '@/hooks/useSuperAdmin';
import { Button } from '@/components/ui/button';
import { Sun, Moon, LogOut, Users, Truck, RotateCcw, BarChart3, Settings } from 'lucide-react';

const bottomItems = [
  { to: '/', icon: LayoutDashboard, label: 'Início' },
  { to: '/produtos', icon: Package, label: 'Produtos' },
  { to: '/vendas', icon: ShoppingCart, label: 'Vendas' },
  { to: '/estoque', icon: Boxes, label: 'Estoque' },
  { to: '/financeiro', icon: DollarSign, label: 'Financeiro' },
];

const moreItems = [
  { to: '/contas-a-receber', icon: Wallet, label: 'A Receber' },
  { to: '/clientes', icon: Users, label: 'Clientes' },
  { to: '/categorias', icon: Tag, label: 'Categorias' },
  { to: '/entregas', icon: Truck, label: 'Entregas' },
  { to: '/trocas', icon: RotateCcw, label: 'Trocas' },
  { to: '/relatorios', icon: BarChart3, label: 'Relatórios' },
  { to: '/historico', icon: Clock, label: 'Histórico' },
  { to: '/configuracoes', icon: Settings, label: 'Configurações' },
  { to: '/pixel', icon: Zap, label: 'Estokfy Pixel' },
];

export default function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { profile, signOut } = useAuth();
  const { dark, toggle } = useTheme();
  const { isSuperAdmin } = useSuperAdmin();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      // Fallback: show instructions
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIOS) {
        alert('Para instalar: toque no botão de compartilhar (↑) no Safari e depois em "Adicionar à Tela de Início".');
      } else {
        alert('Para instalar: toque no menu do navegador (⋮) e depois em "Instalar aplicativo" ou "Adicionar à tela inicial".');
      }
    }
  };

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <>
      {/* Bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border md:hidden safe-area-bottom shadow-elevated">
        <div className="flex items-center justify-around h-16">
          {bottomItems.map((item) => {
            const active = isActive(item.to);
            return (
              <button
                key={item.to}
                onClick={() => navigate(item.to)}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-semibold transition-all duration-200 active:scale-95',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {active && (
                  <motion.span
                    layoutId="mobile-nav-indicator"
                    className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-10 rounded-b-full bg-gradient-primary shadow-glow"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <item.icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-semibold text-muted-foreground active:scale-95 transition-transform"
          >
            <Menu className="h-5 w-5" />
            <span>Mais</span>
          </button>
        </div>
      </nav>

      {/* More menu sheet */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {moreItems.map((item) => (
              <button
                key={item.to}
                onClick={() => { navigate(item.to); setMenuOpen(false); }}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl p-4 transition-colors',
                  isActive(item.to)
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted/50 text-foreground hover:bg-muted'
                )}
              >
                <item.icon className="h-6 w-6" />
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            ))}
          </div>
          {isSuperAdmin && (
            <button
              onClick={() => { navigate('/super-admin'); setMenuOpen(false); }}
              className="flex items-center gap-3 w-full mt-4 p-3 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
            >
              <Shield className="h-5 w-5" />
              <span className="text-sm font-medium">Painel Admin</span>
            </button>
          )}
          <button
            onClick={() => { handleInstall(); setMenuOpen(false); }}
            className="flex items-center gap-3 w-full mt-3 p-3 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <Download className="h-5 w-5" />
            <div className="text-left">
              <span className="text-sm font-medium block">Instalar Aplicativo</span>
              <span className="text-[10px] text-muted-foreground">Adicionar à tela inicial</span>
            </div>
          </button>
          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <div className="text-sm">
              <p className="font-medium">{profile?.full_name || 'Usuário'}</p>
              <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={toggle}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
