import { describe, expect, it } from 'vitest';
import { reportFixture, runReport } from '../test/reportEdgeHarness';

describe('report regression coverage', () => {
  it('associates every sold piece with its buyer, using the sale snapshot', async () => {
    const { status, data } = await runReport(reportFixture());
    expect(status).toBe(200);
    expect(data.sales.list[0]).toMatchObject({ customer: 'Cliente comprador', sale_date: '2026-10-01' });
    expect(data.sales.list[0].items).toHaveLength(2);
    expect(data.sales.list[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Tela vendida', sku: 'TELA', qty: 2, unit_price: 50, line_total: 100 }),
      expect.objectContaining({ name: 'Cabo USB', sku: 'CABO', qty: 1, unit_price: 20, line_total: 20 }),
    ]));
  });
  it('fails visibly when a report query fails instead of exporting partial totals', async () => {
    const result = await runReport(reportFixture(), undefined, 'sale_items');
    expect(result.status).toBe(500);
  });
  it('finds low stock by comparing each product to its own minimum', async () => {
    const { data } = await runReport(reportFixture());
    expect(data.stock.low_stock.map((p: {id: string}) => p.id)).toEqual(['screen']);
  });
  it('loads more than 1000 sales and their items without silent truncation', async () => {
    const f = reportFixture();
    f.sales = Array.from({ length: 1005 }, (_, i) => ({ ...f.sales[0], id: `sale-${i}` }));
    f.sale_items = f.sales.map(s => ({ ...f.sale_items[0], id: `item-${s.id}`, sale_id: s.id }));
    const { data } = await runReport(f);
    expect(data.sales.count).toBe(1005);
    expect(data.sales.top_products[0].qty).toBe(2010);
  });
  it('excludes returned sales and noncash settlements from receipts', async () => {
    const f = reportFixture();
    f.sales.push({ ...f.sales[0], id: 'returned', status: 'returned' });
    f.payments.push(...['pending', 'a_prazo', 'credit', 'return_offset'].map(method => ({ ...f.payments[0], id: method, method, amount: 10 })), { ...f.payments[0], id: 'returned-payment', sale_id: 'returned', amount: 100 });
    const { data } = await runReport(f);
    expect(data.sales.count).toBe(1);
    expect(data.summary.amount_received).toBe(70);
  });
  it('includes receipts from the selected seller’s older sales', async () => {
    const f = reportFixture(); f.sales[0].sale_date = '2026-09-20';
    const { data } = await runReport(f, 'from=2026-10-01&to=2026-10-02&seller=seller');
    expect(data.sales.count).toBe(0);
    expect(data.summary.amount_received_from_old_sales).toBe(70);
  });
  it('keeps stock and cash entries when filtering their creator', async () => {
    const f = reportFixture();
    f.stock_movements = [{ id: 'move', store_id: 'store', created_at: '2026-10-02T16:00:00Z', created_by: 'seller', movement_type: 'purchase_in', qty: 2, total_amount: 25, product_id: 'screen' }];
    f.cash_entries = [{ id: 'expense', store_id: 'store', created_by: 'seller', occurred_at: '2026-10-02T16:00:00Z', entry_type: 'expense', amount: 25, category: 'compra', reference_type: 'stock_purchase' }];
    const { data } = await runReport(f, 'from=2026-10-01&to=2026-10-02&seller=seller');
    expect(data.summary.purchase_total).toBe(25);
    expect(data.summary.expense_total).toBe(25);
    expect(data.summary.net_real_total).toBe(45);
  });
  it('does not count cancelled returns or their refunds', async () => {
    const f = reportFixture();
    f.returns = [{ id: 'return', store_id: 'store', created_at: '2026-10-02T16:00:00Z', status: 'cancelled' }];
    f.return_items = [{ id: 'ri', return_id: 'return', product_id: 'screen', qty: 1, refund_amount: 50 }];
    const { data } = await runReport(f);
    expect(data.returns.count).toBe(0);
    expect(data.summary.refund_total).toBe(0);
  });
  it('uses Brazilian dates and valid receipts for the complete daily series', async () => {
    const f = reportFixture(); f.payments[0].paid_at = '2026-10-02T01:30:00Z';
    const { data } = await runReport(f, 'from=2026-08-01&to=2026-10-02');
    expect(data.daily_series).toHaveLength(63);
    expect(data.daily_series.find((d: {day: string}) => d.day === '2026-10-01').received).toBe(70);
  });
  it('rejects invalid or inverted report dates', async () => {
    for (const params of ['from=2026-02-30&to=2026-03-01', 'from=2026-10-02&to=2026-10-01']) {
      expect((await runReport(reportFixture(), params)).status).toBe(400);
    }
  });
  it('builds sales-related cash income from payments instead of duplicate legacy entries', async () => {
    const f = reportFixture();
    f.cash_entries = [{ id: 'legacy', store_id: 'store', occurred_at: '2026-10-02T16:00:00Z', entry_type: 'income', category: 'venda', amount: 1735, reference_type: 'sale', reference_id: 'sale' }];
    const { data } = await runReport(f);
    expect(data.finance.income_total).toBe(70);
    expect(data.finance.income_by_category.venda).toBe(70);
  });
  it('keeps summary and detailed endpoints on the same sold/received definitions', async () => {
    const f = reportFixture();
    const { data } = await runReport(f, undefined, undefined, 'reports-summary');
    expect(data.net_revenue).toBe(120);
    expect(data.amount_received).toBe(70);
  });
});
