import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addSalesReportTable, formatSoldItems, reportSaleDay } from './reportSales';

const sale = { id: 'sale', time: '2026-10-02T01:00:00Z', sale_date: '2026-09-30', customer: 'Buyer A', net: 100, amount_pending: 20, payment_status: 'partial', payment_method: 'pix', payment_methods: ['pix', 'a_prazo'],
  items: [{ id: 'part', name: 'Screen A', sku: 'TELA-01', qty: 2, unit_price: 50, line_total: 100 }], notes: null };

describe('sales report output', () => {
  it('uses the actual sale date, including backdated sales', () => {
    expect(reportSaleDay(sale)).toBe('2026-09-30');
    expect(reportSaleDay({ ...sale, sale_date: undefined })).toBe('2026-10-01');
  });
  it('identifies each piece and quantity without discarding long names', () => {
    expect(formatSoldItems(sale.items)).toBe('2 x Screen A [TELA-01]');
    expect(formatSoldItems([])).toBe('Itens não informados');
  });
  it('exports every buyer and piece after the old 200-sale limit', () => {
    const doc = new jsPDF({ unit: 'pt' });
    const sales = Array.from({ length: 205 }, (_, i) => ({ ...sale, id: `sale-${i}`, customer: `Buyer ${i}`, items: [{ ...sale.items[0], name: `Piece ${i}` }] }));
    addSalesReportTable(doc, autoTable, sales, 50);
    const pdf = doc.output();
    expect(pdf).toContain('Buyer 204');
    expect(pdf).toContain('Piece 204');
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
