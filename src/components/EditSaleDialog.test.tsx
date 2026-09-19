import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import EditSaleDialog from './EditSaleDialog';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), error: vi.fn(), status: 'pending', paid: 0 }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: profile }) }));
const profile = { store_id: 'store', role: 'owner' };
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
 rpc: mocks.rpc,
 from: (table: string) => {
  const data = table === 'sales' ? { id: 'sale', payment_status: mocks.status, amount_paid: mocks.paid, net_total: 100, created_at: '2026-01-01', customer_id: null } : table === 'sale_items' ? [{ product_id: 'product', qty: 1, unit_price: 100, products: { name: 'Peça', on_hand: 10 } }] : table === 'products' ? [{ id: 'product', name: 'Peça', on_hand: 10 }] : [];
  const q: Record<string, unknown> = {};
  for (const name of ['select','eq','order','limit','range','maybeSingle']) q[name] = () => q;
  q.then = (resolve: (v: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve);
  return q;
 }
} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn(), error: mocks.error } }));
vi.mock('@/components/ui/dialog', () => ({
 Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null,
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
describe('sale editor preserves concurrent payments', () => {
 let root: Root; let container: HTMLDivElement;
 beforeEach(async () => {
  vi.clearAllMocks(); mocks.status = 'pending'; mocks.paid = 0;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.rpc.mockImplementation(async (_name, args) => args.p_confirm_revert_payment ? { data: {}, error: null } : { data: null, error: { message: 'CONFIRM_REVERT_PAYMENT_REQUIRED' } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<EditSaleDialog saleId="sale" open onOpenChange={() => {}} />));
 });
 afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
 function click(text: string) { const el = [...container.querySelectorAll('button')].find(b => b.textContent === text); expect(el).toBeDefined(); el!.click(); }
 async function review() {
  const field = container.querySelector('textarea[required]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Corrigir observação'); field.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => click('Revisar e confirmar'));
 }
 it('does not authorize a reversal when another session settles after the editor opened', async () => {
  await review();
  await act(async () => click('Confirmar edição'));
  expect(mocks.rpc).toHaveBeenCalledWith('edit_sale_atomic', expect.objectContaining({ p_payment_status: 'pending', p_confirm_revert_payment: false }));
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Nenhum pagamento foi estornado'));
 });
 it('does not submit two edits on rapid clicks', async () => {
  await review();
  await act(async () => { click('Confirmar edição'); click('Confirmar edição'); });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });

 it('requires the typed confirmation before authorizing an intentional reversal', async () => {
  await act(async () => root.render(<EditSaleDialog saleId="sale" open={false} onOpenChange={() => {}} />));
  mocks.status = 'paid'; mocks.paid = 100;
  await act(async () => root.render(<EditSaleDialog saleId="sale" open onOpenChange={() => {}} />));
  await act(async () => click('Marcar como não paga'));
  const status = [...container.querySelectorAll('select')].find(el => el.value === 'paid')!;
  await act(async () => { status.value='pending'; status.dispatchEvent(new Event('change', { bubbles:true })); });
  await review();
  await act(async () => click('Confirmar edição'));
  expect(mocks.rpc).not.toHaveBeenCalled();
  const input = container.querySelector('#revert-confirm-text')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'ESTORNAR'); input.dispatchEvent(new Event('input',{bubbles:true})); });
  await act(async () => click('Confirmar edição'));
  expect(mocks.rpc).toHaveBeenCalledWith('edit_sale_atomic', expect.objectContaining({ p_confirm_revert_payment: true }));
 });
});
