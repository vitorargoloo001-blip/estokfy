import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Sales from './Sales';

const state = vi.hoisted(() => ({
  selects: [] as string[],
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  sales: [] as unknown[],
  statuses: [] as Array<{ payment_id: string; status: string }>,
}));

const auth = vi.hoisted(() => ({ profile: { id: 'me', store_id: 'store', role: 'sales', full_name: 'Camila' } }));

vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const q: Record<string, unknown> = {};
    for (const name of ['eq', 'is', 'gte', 'lte', 'ilike', 'order', 'range']) q[name] = () => q;
    q.select = (cols: string) => { state.selects.push(cols); return q; };
    q.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: state.sales, count: state.sales.length, error: null }).then(resolve);
    return q;
  },
  rpc: (fn: string, args: unknown) => {
    state.rpcCalls.push({ fn, args });
    return Promise.resolve({ data: fn === 'get_payments_bank_status' ? state.statuses : null, error: null });
  },
} }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: (v: unknown) => v }));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canManageEmployees: false }) }));
vi.mock('@/hooks/useConnectModuleAccess', () => ({ useConnectModuleAccess: () => ({ canAccess: true }) }));
vi.mock('@/components/EmployeeFilter', () => ({ default: () => null }));
vi.mock('@/components/SaleDetailDialog', () => ({ default: () => null }));
vi.mock('@/components/SettlePaymentDialog', () => ({ default: () => null }));
vi.mock('@/components/EditSaleDialog', () => ({ default: () => null }));

const sale = (id: string, payments: Array<{ id: string; method: string; amount: number }>) => ({
  id, created_at: '2026-10-30T15:00:00Z', created_by: 'me', status: 'completed', payment_status: 'paid',
  net_total: 50, gross_total: 50, discount_total: 0, profit_gross: 20, amount_paid: 50, amount_pending: 0,
  customers: { name: `Cliente ${id}` }, profiles: { full_name: 'Camila' }, payments,
});

describe('Vendas: status de conciliação', () => {
  let root: Root;
  let container: HTMLDivElement;

  const render = async () => {
    await act(async () => root.render(<Sales />));
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  };
  const rowText = (customer: string) =>
    [...container.querySelectorAll('tr')].find(tr => tr.textContent?.includes(customer))?.textContent ?? '';

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    state.selects = [];
    state.rpcCalls = [];
    state.sales = [
      sale('s1', [{ id: 'p1', method: 'pix', amount: 50 }]),
      sale('s2', [{ id: 'p2', method: 'pix', amount: 50 }]),
      sale('s3', [{ id: 'p3', method: 'cash', amount: 50 }]),
    ];
    state.statuses = [{ payment_id: 'p1', status: 'confirmed' }];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('não lê reconciliation_matches direto (a vendedora não tem acesso)', async () => {
    await render();
    expect(state.selects.some(s => s.includes('reconciliation_matches'))).toBe(false);
  });

  it('pede o status só dos pagamentos em Pix/cartão', async () => {
    await render();
    expect(state.rpcCalls).toEqual([{ fn: 'get_payments_bank_status', args: { p_payment_ids: ['p1', 'p2'] } }]);
  });

  it('mostra "Confirmado pelo banco" para o pagamento confirmado e "Aguardando banco" para o resto', async () => {
    await render();
    expect(rowText('Cliente s1')).toContain('Confirmado pelo banco');
    expect(rowText('Cliente s2')).toContain('Aguardando banco');
    expect(rowText('Cliente s3')).not.toMatch(/banco/);
  });

  it('não chama a consulta quando não há pagamento conferível', async () => {
    state.sales = [sale('s3', [{ id: 'p3', method: 'cash', amount: 50 }])];
    await render();
    expect(state.rpcCalls).toHaveLength(0);
  });
});
