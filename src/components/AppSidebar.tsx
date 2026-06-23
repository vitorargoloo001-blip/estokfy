import { memo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Truck,
  RotateCcw,
  DollarSign,
  BarChart3,
  LogOut,
  Settings,
  Layers,
  Moon,
  Sun,
  Tag,
  Clock,
  Shield,
  Zap,
  ShoppingBag,
  Wallet,
  Trophy,
  UserCog,
  HelpCircle,
  Wrench,
  CreditCard,
  ArrowLeftRight,
  Landmark,
  Banknote,
  AlertTriangle,
  ScrollText,
  BrainCircuit,
  Target,
  Lightbulb,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import { useLowStockAlert } from '@/hooks/useLowStockAlert';
import { useSuperAdmin } from '@/hooks/useSuperAdmin';
import { useConnectModuleAccess } from '@/hooks/useConnectModuleAccess';
import { canAccessRoute } from '@/lib/roleAccess';
import { useBusinessLabels } from '@/hooks/useBusinessLabels';

// Estokfy AI — shown for owner/admin/manager only (checked via canAccessRoute)
const aiSection = {
  label: 'Estokfy IA',
  items: [
    { to: '/ai', icon: BrainCircuit, label: 'Copiloto IA' },
    { to: '/ai/insights', icon: Lightbulb, label: 'Insights' },
    { to: '/ai/ceo', icon: Target, label: 'Dashboard CEO' },
  ],
};

// Estokfy Connect — only shown when the store's `connect` module is licensed/active
const connectSection = {
  label: 'Estokfy Connect',
  items: [
    { to: '/connect', icon: LayoutDashboard, label: 'Visão Geral' },
    { to: '/connect/bancos', icon: Landmark, label: 'Bancos' },
    { to: '/connect/transacoes', icon: Banknote, label: 'Transações' },
    { to: '/connect/conciliacao', icon: ArrowLeftRight, label: 'Conciliação' },
    { to: '/connect/divergencias', icon: AlertTriangle, label: 'Divergências' },
    { to: '/connect/auditoria', icon: ScrollText, label: 'Auditoria' },
    { to: '/connect/configuracoes', icon: Settings, label: 'Configurações' },
  ],
};

const sections: { label: string; items: { to: string; icon: any; label: string; requiresManage?: boolean }[] }[] = [
  {
    label: 'Visão geral',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/relatorios', icon: BarChart3, label: 'Relatórios' },
      { to: '/relatorios/compras', icon: ShoppingBag, label: 'Compras' },
      { to: '/relatorios/trocas', icon: ArrowLeftRight, label: 'Trocas (Relatório)' },
    ],
  },
  {
    label: 'Operação',
    items: [
      { to: '/produtos', icon: Package, label: 'Produtos' },
      { to: '/categorias', icon: Tag, label: 'Categorias' },
      { to: '/estoque', icon: Layers, label: 'Estoque' },
      { to: '/produtos-parados', icon: Clock, label: 'Produtos Parados' },
      { to: '/vendas', icon: ShoppingCart, label: 'Vendas' },
      { to: '/contas-a-receber', icon: Wallet, label: 'Contas a Receber' },
      { to: '/contas-a-pagar', icon: DollarSign, label: 'Contas a Pagar' },
      { to: '/clientes', icon: Users, label: 'Clientes' },
      { to: '/fidelidade', icon: Trophy, label: 'Fidelidade' },
      { to: '/creditos', icon: CreditCard, label: 'Créditos' },
      { to: '/entregas', icon: Truck, label: 'Entregas' },
      { to: '/trocas', icon: RotateCcw, label: 'Trocas' },
      { to: '/os', icon: Wrench, label: 'Ordem de Serviço' },
    ],
  },
  {
    label: 'Equipe',
    items: [
      { to: '/funcionarios', icon: UserCog, label: 'Funcionários', requiresManage: true },
    ],
  },
  {
    label: 'Plataforma',
    items: [
      { to: '/financeiro', icon: DollarSign, label: 'Financeiro' },
      { to: '/historico', icon: Clock, label: 'Histórico' },
      { to: '/pixel', icon: Zap, label: 'Estokfy Pixel' },
      { to: '/ajuda', icon: HelpCircle, label: 'Ajuda / Treinamento' },
    ],
  },
];

function AppSidebarImpl() {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const { dark, toggle } = useTheme();
  const lowStockCount = useLowStockAlert(profile?.store_id);
  const { isSuperAdmin } = useSuperAdmin();
  const { canManageEmployees } = usePermissions();
  const { canAccess: connectEnabled } = useConnectModuleAccess();
  const { labels } = useBusinessLabels();
  // SINGLE SOURCE OF TRUTH: Connect group appears only when the store's `connect` module
  // is active (hasModule). No super-admin bypass — same gate as the route and the page,
  // so "menu aparece ⟺ página abre". Super admin manages licenses via the Super Admin area.
  const canAccessAI = ['owner', 'admin', 'manager'].includes(profile?.role ?? '');
  const sectionsWithAI = canAccessAI ? [...sections, aiSection] : sections;
  const allSections = connectEnabled ? [...sectionsWithAI, connectSection] : sectionsWithAI;
  // Apply dynamic label to OS item based on business type
  const allSectionsWithLabels = allSections.map(section => ({
    ...section,
    items: section.items.map(item =>
      item.to === '/os' ? { ...item, label: labels.work_order } : item,
    ),
  }));
  const visibleSections = allSectionsWithLabels
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => {
        if (i.requiresManage && !canManageEmployees) return false;
        return canAccessRoute(profile?.role, i.to);
      }),
    }))
    .filter((s) => s.items.length > 0);

  const isItemActive = (to: string) =>
    to === '/' || to === '/connect'
      ? location.pathname === to
      : location.pathname.startsWith(to);

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 px-5 border-b border-sidebar-border">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground font-bold text-sm shadow-md">
          E
          <span className="absolute inset-0 rounded-xl bg-gradient-primary opacity-50 blur-md -z-10" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-sidebar-accent-foreground tracking-tight">Estokfy</span>
          <span className="text-[11px] text-sidebar-foreground/60">Gestão Inteligente</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {visibleSections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label }) => {
                const isActive = isItemActive(to);
                const showBadge = to === '/estoque' && lowStockCount > 0;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'text-primary'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    )}
                  >
                    {isActive && (
                      <>
                        <span className="absolute inset-0 rounded-xl bg-gradient-primary-soft border border-primary/15" />
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-gradient-primary" />
                      </>
                    )}
                    <Icon
                      className={cn(
                        'relative z-10 h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110',
                        isActive && 'text-primary'
                      )}
                    />
                    <span className="relative z-10 truncate">{label}</span>
                    {showBadge && (
                      <span className="relative z-10 ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[10px] font-bold text-warning-foreground shadow-sm">
                        {lowStockCount}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-0.5">
        {isSuperAdmin && (
          <NavLink
            to="/super-admin"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-primary hover:bg-sidebar-accent transition-colors"
          >
            <Shield size={18} />
            Super Admin
          </NavLink>
        )}
        <button
          onClick={toggle}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
          {dark ? 'Modo Claro' : 'Modo Escuro'}
        </button>
        {canAccessRoute(profile?.role, '/configuracoes') && (
          <NavLink
            to="/configuracoes"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Settings size={18} />
            Configurações
          </NavLink>
        )}
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut size={18} />
          Sair
        </button>
        {profile && (
          <div className="mt-2 rounded-xl bg-gradient-primary-soft border border-primary/10 px-3 py-2.5">
            <p className="text-xs font-semibold text-sidebar-accent-foreground truncate">
              {profile.full_name || 'Usuário'}
            </p>
            <p className="text-[11px] text-sidebar-foreground/60 capitalize">{profile.role}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

const AppSidebar = memo(AppSidebarImpl);
export default AppSidebar;
