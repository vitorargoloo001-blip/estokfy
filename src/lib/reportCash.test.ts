import { describe, expect, it } from 'vitest';
import { reportFixture, runReport } from '../test/reportEdgeHarness';

// Cenário: venda de R$ 120 com R$ 70 em Pix no ato e R$ 50 em dinheiro pagos depois (conta a receber).
function cashFixture() {
  const f = reportFixture();
  f.profiles[0].full_name = 'Thais';
  f.sales[0].amount_pending = 0;
  f.sales[0].payment_status = 'paid';
  f.sales[0].amount_paid = 120;
  f.payments.push({ id: 'receb', store_id: 'store', sale_id: 'sale', method: 'cash', amount: 50, paid_at: '2026-10-02T18:00:00Z', created_at: '2026-10-02T18:00:00Z', created_by: null, note: '[Lote] Recebimento' });
  return f;
}

describe('fechamento de caixa no relatório', () => {
  it('o total do caixa é exatamente o recebido do período', async () => {
    const { data } = await runReport(cashFixture());
    expect(data.caixa.total).toBe(120);
    expect(data.caixa.total).toBe(data.summary.amount_received);
  });

  it('separa por forma e por tipo (venda na hora x conta a receber)', async () => {
    const { data } = await runReport(cashFixture());
    expect(data.caixa.by_method.pix).toMatchObject({ amount: 70, sales_amount: 70, receivables_amount: 0 });
    expect(data.caixa.by_method.cash).toMatchObject({ amount: 50, sales_amount: 0, receivables_amount: 50 });
  });

  it('cada entrada traz horário, cliente, vendedora e forma', async () => {
    const { data } = await runReport(cashFixture());
    const pix = data.caixa.entries.find((e: { method: string }) => e.method === 'pix');
    const cash = data.caixa.entries.find((e: { method: string }) => e.method === 'cash');
    expect(pix).toMatchObject({ kind: 'venda', customer: 'Cliente comprador', seller: 'Thais', amount: 70 });
    expect(cash).toMatchObject({ kind: 'recebimento', customer: 'Cliente comprador', seller: 'Thais', amount: 50, time: '2026-10-02T18:00:00Z' });
  });

  it('venda fiado continua na lista de em aberto mesmo quitada depois', async () => {
    const { data } = await runReport(cashFixture());
    expect(data.caixa.open_sales).toEqual([expect.objectContaining({ sale_id: 'sale', open_at_sale: 50, pending_now: 0, seller: 'Thais' })]);
    expect(data.caixa.open_total).toBe(0);
  });

  it('crédito de loja e abatimento ficam fora do caixa e aparecem à parte', async () => {
    const f = cashFixture();
    f.payments.push({ ...f.payments[0], id: 'credit', method: 'credit', amount: 10 }, { ...f.payments[0], id: 'offset', method: 'return_offset', amount: 5 });
    const { data } = await runReport(f);
    expect(data.caixa.total).toBe(120);
    expect(data.caixa.non_cash).toEqual({ credit: 10, return_offset: 5 });
  });

  it('pagamento sem created_at (legado) usa paid_at para decidir venda na hora', async () => {
    const f = reportFixture();
    f.payments[0].created_at = null;
    const { data } = await runReport(f);
    expect(data.caixa.entries[0].kind).toBe('venda');
  });
});
