import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { format } from 'date-fns';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import NewSale from './NewSale';

const state = vi.hoisted(() => ({
  probeOk: true,
  email: 'cliente@exemplo.com' as string | null,
  updateRows: 1,
  updates: [] as Array<{ table: string; payload: unknown }>,
}));
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
const auth = vi.hoisted(() => ({
  session: { access_token: 't' },
  user: { id: 'u' },
  profile: { id: 'me', store_id: 'store', role: 'owner', full_name: 'Vendedora' },
}));
const PRODUCT = vi.hoisted(() => ({ id: 'p1', sku: 'S1', name: 'Película', brand: null, model: null, sale_price: 100, on_hand: 5, categories: null }));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api', () => ({ invokeEdgeFunction: api.invoke, validateUserProfile: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    let single = false;
    let updating = false;
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'or', 'order', 'limit', 'is']) q[name] = () => q;
    q.maybeSingle = () => { single = true; return q; };
    q.update = (payload: unknown) => { updating = true; state.updates.push({ table, payload }); return q; };
    q.then = (resolve: (v: unknown) => void) => {
      const data = updating ? Array.from({ length: state.updateRows }, () => ({ id: 'cust-1' }))
        : table === 'products' ? (single ? PRODUCT : [PRODUCT])
        : table === 'customers' ? (single ? { email: state.email } : [])
        : single ? null : [];
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return q;
  },
} }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/hooks/useDebouncedValue', () => ({ useDebouncedValue: (v: unknown) => v }));
vi.mock('@/hooks/useBarcodeScanner', () => ({ useBarcodeScanner: () => {}, beep: () => {} }));
vi.mock('@/hooks/usePrintSettings', () => ({ usePrintSettings: () => ({ settings: { enabled: false } }) }));
vi.mock('@/components/CustomerSearch', () => ({
  CustomerSearch: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button onClick={() => onChange('cust-1')}>Selecionar cliente</button>
  ),
}));
vi.mock('@/components/PixChargeDialog', () => ({
  default: ({ saleId, amountPending, open }: { saleId: string | null; amountPending: number; open: boolean }) =>
    open ? <div data-testid="pix-dialog">{saleId}|{amountPending}</div> : null,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

describe('PIX QR Code na nova venda', () => {
  let root: Root;
  let container: HTMLDivElement;

  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  const paymentSelect = () => [...container.querySelectorAll('select')].find(s => s.querySelector('option[value="pending"]'));
  const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
    await flush();
  };
  const click = async (el: HTMLElement | undefined) => {
    expect(el).toBeTruthy();
    await act(async () => { el!.click(); });
    await flush();
  };
  const render = async () => {
    await act(async () => root.render(<NewSale />));
    await flush();
  };
  const addProduct = async () => {
    await setValue(container.querySelector<HTMLInputElement>('input[placeholder^="Buscar por nome"]')!, 'Pel');
    await click([...container.querySelectorAll('button')].find(b => b.textContent?.includes('Película')));
  };
  const salesCreateCalls = () => api.invoke.mock.calls.filter(([fn]) => fn === 'sales-create');

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    state.probeOk = true;
    state.email = 'cliente@exemplo.com';
    state.updateRows = 1;
    state.updates = [];
    api.invoke.mockReset();
    api.invoke.mockImplementation(async (fn: string, opts: { body?: { probe?: boolean } }) => {
      if (fn === 'mercadopago-pix-create' && opts.body?.probe) {
        if (state.probeOk) return { enabled: true };
        throw new Error('Pix ainda não habilitado para esta loja');
      }
      if (fn === 'sales-create') return { sale_id: 'sale-1' };
      throw new Error(`chamada inesperada: ${fn}`);
    });
    toastMock.error.mockReset();
    toastMock.success.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('só oferece PIX QR Code quando o Pix está habilitado para a loja', async () => {
    await render();
    expect(paymentSelect()!.querySelector('option[value="pix_qr"]')).toBeTruthy();

    act(() => root.unmount());
    state.probeOk = false;
    root = createRoot(container);
    await render();
    expect(paymentSelect()!.querySelector('option[value="pix_qr"]')).toBeNull();
  });

  it('registra a parte em QR como pendente com vencimento hoje e abre o QR Code', async () => {
    await render();
    await addProduct();
    await setValue(paymentSelect()!, 'pix_qr');
    await click(button('Selecionar cliente'));
    await click(button('Finalizar Venda'));

    expect(salesCreateCalls()).toHaveLength(1);
    const payload = salesCreateCalls()[0][1].body;
    expect(payload.payments).toEqual([{ method: 'pending', amount: 100 }]);
    expect(payload.due_date).toBe(format(new Date(), 'yyyy-MM-dd'));
    expect(container.querySelector('[data-testid="pix-dialog"]')?.textContent).toBe('sale-1|100');
    expect(button('Mostrar QR Code')).toBeTruthy();
  });

  const emailInput = () => container.querySelector<HTMLInputElement>('#pix-customer-email');
  const selectPixQrForCustomerWithoutEmail = async () => {
    state.email = null;
    await render();
    await addProduct();
    await setValue(paymentSelect()!, 'pix_qr');
    await click(button('Selecionar cliente'));
  };

  it('não mostra o campo de e-mail quando o cliente já tem e-mail', async () => {
    await render();
    await addProduct();
    await setValue(paymentSelect()!, 'pix_qr');
    await click(button('Selecionar cliente'));
    expect(emailInput()).toBeNull();
  });

  it('cliente sem e-mail: a vendedora informa ali, o e-mail é salvo no cadastro e a venda é registrada', async () => {
    await selectPixQrForCustomerWithoutEmail();
    expect(emailInput()).toBeTruthy();

    await setValue(emailInput()!, '  maria@exemplo.com ');
    await click(button('Finalizar Venda'));

    expect(state.updates).toEqual([{ table: 'customers', payload: { email: 'maria@exemplo.com' } }]);
    expect(salesCreateCalls()).toHaveLength(1);
    expect(container.querySelector('[data-testid="pix-dialog"]')?.textContent).toBe('sale-1|100');
  });

  it('não registra a venda em QR sem e-mail informado', async () => {
    await selectPixQrForCustomerWithoutEmail();
    await click(button('Finalizar Venda'));

    expect(state.updates).toHaveLength(0);
    expect(salesCreateCalls()).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalledWith('Para cobrar por PIX QR Code, informe o e-mail do cliente.');
  });

  it('não salva nem registra com e-mail inválido', async () => {
    await selectPixQrForCustomerWithoutEmail();
    await setValue(emailInput()!, 'maria@exemplo');
    await click(button('Finalizar Venda'));

    expect(state.updates).toHaveLength(0);
    expect(salesCreateCalls()).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalledWith('E-mail do cliente inválido.');
  });

  it('não registra a venda se o banco não gravar o e-mail', async () => {
    await selectPixQrForCustomerWithoutEmail();
    state.updateRows = 0;
    await setValue(emailInput()!, 'maria@exemplo.com');
    await click(button('Finalizar Venda'));

    expect(salesCreateCalls()).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalledWith('Não foi possível salvar o e-mail do cliente. Tente de novo ou edite o cadastro em Clientes.');
  });

  it('não registra a venda em QR sem cliente', async () => {
    await render();
    await addProduct();
    await setValue(paymentSelect()!, 'pix_qr');
    await click(button('Finalizar Venda'));

    expect(salesCreateCalls()).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalledWith('Para cobrar por PIX QR Code, selecione o cliente.');
  });
});
