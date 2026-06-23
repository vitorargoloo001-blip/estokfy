// Role → allowed route prefixes. '/' is always allowed (dashboard) unless excluded.
export type AppRole = 'owner' | 'admin' | 'manager' | 'sales' | 'stock' | 'finance' | 'viewer';

const ALL = ['*'];

// Routes each role can access. '*' = full access.
const ROLE_ROUTES: Record<AppRole, string[]> = {
  owner: ALL,
  admin: ALL,
  manager: ['/', '/relatorios', '/relatorios/compras', '/produtos', '/categorias', '/estoque',
    '/produtos-parados', '/vendas', '/contas-a-receber', '/contas-a-pagar', '/clientes',
    '/fidelidade', '/creditos', '/entregas', '/trocas', '/funcionarios', '/financeiro', '/historico',
    '/pixel', '/os', '/connect', '/ai', '/ajuda'],
  sales: ['/', '/vendas', '/clientes', '/fidelidade', '/creditos', '/entregas', '/trocas', '/contas-a-receber', '/os', '/ajuda'],
  stock: ['/', '/produtos', '/categorias', '/estoque', '/produtos-parados', '/relatorios/compras', '/os', '/ajuda'],
  finance: ['/', '/contas-a-receber', '/contas-a-pagar', '/financeiro', '/relatorios', '/clientes', '/creditos', '/connect', '/os', '/ajuda'],
  viewer: ['/', '/ajuda'],
};

export function canAccessRoute(role: string | undefined, path: string): boolean {
  const r = (role || 'viewer') as AppRole;
  const allowed = ROLE_ROUTES[r] || ROLE_ROUTES.viewer;
  if (allowed.includes('*')) return true;
  // exact match or known sub-routes
  if (allowed.includes(path)) return true;
  return allowed.some((p) => p !== '/' && path.startsWith(p + '/'));
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  manager: 'Gerente',
  sales: 'Vendedor',
  stock: 'Estoque',
  finance: 'Caixa / Financeiro',
  viewer: 'Visualizador',
};
