import type { jsPDF } from 'jspdf';
import type autoTable from 'jspdf-autotable';
import { isoToDayBR, TZ_BR } from './dateBR';
import { labelMethod } from './financialReport';

export interface ReportSaleItem {
  id: string;
  name: string;
  sku: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface ReportSale {
  id: string;
  time: string;
  sale_date?: string;
  customer: string;
  customer_id?: string | null;
  items?: ReportSaleItem[];
  payment_method: string | null;
  payment_methods?: string[];
  payment_status?: string;
  net: number;
  amount_pending?: number;
  notes?: string | null;
}

export const reportSaleDay = (sale: Pick<ReportSale, 'sale_date' | 'time'>) => sale.sale_date || isoToDayBR(sale.time);
export const reportDateLabel = (day: string) => day.split('-').reverse().join('/');
export const formatSoldItems = (items?: ReportSaleItem[]) => items?.length
  ? items.map(item => `${item.qty} x ${item.name}${item.sku && item.sku !== '-' ? ` [${item.sku}]` : ''}`).join('\n')
  : 'Itens não informados';
export const salePaymentLabel = (sale: ReportSale) => {
  const methods = sale.payment_methods?.length ? sale.payment_methods : sale.payment_method ? [sale.payment_method] : [];
  return methods.length ? [...new Set(methods)].map(labelMethod).join(' + ') : 'Não informado';
};

/** Shared by the general and sales PDFs: no implicit sale or item limits. */
export function addSalesReportTable(doc: jsPDF, table: typeof autoTable, sales: ReportSale[], startY: number): number {
  const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const status: Record<string, string> = { paid: 'Pago', partial: 'Parcial', pending: 'Pendente' };
  const ordered = [...sales].sort((a, b) => reportSaleDay(b).localeCompare(reportSaleDay(a)) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  const width = doc.internal.pageSize.getWidth() - 80;
  table(doc, {
    startY, theme: 'striped', margin: { top: 40, left: 40, right: 40, bottom: 35 },
    head: [['Data / hora', 'Cliente', 'Peças vendidas', 'Pagamento / status', 'Total venda', 'Pendente']],
    body: ordered.map(sale => [
      `${reportDateLabel(reportSaleDay(sale))}\n${new Date(sale.time).toLocaleTimeString('pt-BR', { timeZone: TZ_BR, hour: '2-digit', minute: '2-digit' })}`,
      `${sale.customer}${sale.notes ? `\nObs.: ${sale.notes}` : ''}`,
      formatSoldItems(sale.items),
      `${salePaymentLabel(sale)}\n${status[sale.payment_status || ''] || 'Não informado'}`,
      money(sale.net), money(sale.amount_pending || 0),
    ]),
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 8, cellPadding: 5, overflow: 'linebreak', valign: 'top' },
    columnStyles: {
      0: { cellWidth: width * 0.12 }, 1: { cellWidth: width * 0.18 },
      2: { cellWidth: width * 0.29 }, 3: { cellWidth: width * 0.17 },
      4: { cellWidth: width * 0.12, halign: 'right' }, 5: { cellWidth: width * 0.12, halign: 'right' },
    },
  });
  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}
