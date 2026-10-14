import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import EditSaleDialog from './EditSaleDialog';

const mocks = vi.hoisted(() => ({ creator: 'me', method: 'cash' }));
const profile = vi.hoisted(() => ({ id: 'me', store_id: 'store', role: 'sales' }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: vi.fn(),
  from: (table: string) => {
    const data = table === 'sales'
      ? { id: 'sale', payment_status: 'paid', amount_paid: 100, net_total: 100, status: 'paid', created_at: '2026-01-01T12:00:00Z', customer_id: null, discount_total: 0, shipping_fee: 0, notes: null, created_by: mocks.creator }
      : table === 'sale_items' ? [{ product_id: 'p', qty: 1, unit_price: 100, products: { name: 'Peça', on_hand: 10 } }]
      : table === 'products' ? [{ id: 'p', name: 'Peça', on_hand: 10, sale_price: 100 }]
      : table === 'payments' ? [{ id: 'pay', method: mocks.method, amount: 100, paid_at: '2026-01-01T12:00:00Z' }]
      : [];
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'is', 'order', 'limit', 'range', 'maybeSingle']) q[name] = () => q;
    q.then = (resolve: (v: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve);
    return q;
  },
} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));
vi.mock('@/components/ui/searchable-select', () => ({ SearchableSelect: () => null }));

describe('vendedora na edição de venda', () => {
  let root: Root;
  let container: HTMLDivElement;

  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const render = async () => {
    await act(async () => root.render(<EditSaleDialog saleId="sale" open onOpenChange={() => {}} />));
    await flush();
  };
  const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    profile.role = 'sales';
    profile.id = 'me';
    mocks.creator = 'me';
    mocks.method = 'cash';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('abre o editor da própria venda', async () => {
    await render();
    expect(button('Revisar e confirmar')).toBeDefined();
    expect(container.textContent).not.toContain('Você só pode editar');
  });

  it('bloqueia a venda de outra vendedora', async () => {
    mocks.creator = 'outra';
    await render();
    expect(container.textContent).toContain('Você só pode editar as vendas feitas por você.');
    expect(button('Revisar e confirmar')).toBeUndefined();
  });

  it('não oferece "Marcar como não paga" para vendedora', async () => {
    await render();
    expect(button('Marcar como não paga')).toBeUndefined();
  });

  it('mostra "Corrigir forma" no recebimento em dinheiro', async () => {
    await render();
    expect(button('Corrigir forma')).toBeDefined();
  });

  it('não oferece correção para crédito de loja', async () => {
    mocks.method = 'credit';
    await render();
    expect(button('Corrigir forma')).toBeUndefined();
  });
});
