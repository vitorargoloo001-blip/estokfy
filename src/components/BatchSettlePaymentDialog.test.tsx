import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import BatchSettlePaymentDialog from './BatchSettlePaymentDialog';

const mocks = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({
  select: () => ({ in: () => ({ is: () => ({ neq: mocks.query }) }) }),
}) } }));
vi.mock('@/lib/api', () => ({ invokeEdgeFunction: mocks.send }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/scroll-area', () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

describe('batch payment interaction', () => {
  let root: Root;
  let container: HTMLDivElement;
  const close = vi.fn();
  const refresh = vi.fn();
  const rows = [
    { id: 'first', created_at: '2026-01-01', due_date: '2026-01-10', amount_pending: 20 },
    { id: 'second', created_at: '2026-02-01', due_date: '2026-02-10', amount_pending: 30 },
    { id: 'third', created_at: '2026-03-01', due_date: '2026-03-10', amount_pending: 40 },
  ];
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.query.mockResolvedValue({ data: rows, error: null });
    mocks.send.mockResolvedValue({});
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<BatchSettlePaymentDialog customerName="Cliente" sales={rows} open onOpenChange={close} onSettled={refresh} />));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  function receive() {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent?.startsWith('Receber '));
    expect(button).toBeDefined(); return button!;
  }
  it('sends each exact amount in chronological order and refreshes', async () => {
    await act(async () => receive().click());
    expect(mocks.send.mock.calls.map(call => call[1].body)).toMatchObject([
      { sale_id: 'first', payments: [{ amount: 20 }] },
      { sale_id: 'second', payments: [{ amount: 30 }] },
      { sale_id: 'third', payments: [{ amount: 40 }] },
    ]);
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledWith(false);
  });
  it('blocks a second click before React has rendered the disabled button', async () => {
    await act(async () => { const button = receive(); button.click(); button.click(); });
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it('does not silently lower the receipt when balances change', async () => {
    mocks.query.mockResolvedValue({ data: rows.map(r => ({ ...r, amount_pending: 1 })), error: null });
    await act(async () => receive().click());
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled(); expect(refresh).toHaveBeenCalled();
  });
  it('does not use stale balances when the database cannot be read', async () => {
    mocks.query.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await act(async () => receive().click());
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalled();
  });
  it('stops after an uncertain failure and clears the dialog for review', async () => {
    mocks.send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('timeout'));
    await act(async () => receive().click());
    expect(mocks.send).toHaveBeenCalledTimes(2); expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('1 conta(s) confirmada(s)'));
    expect(close).toHaveBeenCalledWith(false); expect(refresh).toHaveBeenCalled();
  });
});
