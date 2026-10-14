import type { jsPDF } from 'jspdf';
import type autoTable from 'jspdf-autotable';
import { TZ_BR } from './dateBR';

export interface CashEntry {
  id: string;
  kind: 'venda' | 'recebimento';
  time: string;
  registered_at: string;
  method: string;
  amount: number;
  customer: string;
  seller: string;
  sale_id: string;
  sale_date: string | null;
}

export interface CashOpenSale {
  sale_id: string;
  time: string;
  customer: string;
  seller: string;
  net: number;
  open_at_sale: number;
  pending_now: number;
  due_date: string | null;
}

export interface CashMethodTotal { amount: number; count: number; sales_amount: number; receivables_amount: number }

export interface CashData {
  total: number;
  by_method: Record<string, CashMethodTotal>;
  entries: CashEntry[];
  open_sales: CashOpenSale[];
  open_total: number;
  non_cash: { credit: number; return_offset: number };
}

/** Métodos que não são entrada de caixa (o servidor usa a mesma lista). */
export const RECEIVED_EXCLUDED_METHODS = '(pending,a_prazo,credit,return_offset)';

export type CashFilter = 'all' | 'cash' | 'pix' | 'card';

export const CASH_METHOD_LABEL: Record<string, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  debit_card: 'Cartão débito',
  credit_card: 'Cartão crédito',
  card: 'Cartão',
  transfer: 'Transferência',
};

const CARD_METHODS = ['debit_card', 'credit_card', 'card'];

export const matchesCashFilter = (method: string, filter: CashFilter) => {
  if (filter === 'all') return true;
  if (filter === 'cash') return method === 'cash';
  if (filter === 'pix') return method === 'pix';
  return CARD_METHODS.includes(method);
};

export const filterCashEntries = (entries: CashEntry[], filter: CashFilter) =>
  entries.filter(e => matchesCashFilter(e.method, filter));

export const sumAmounts = (rows: { amount: number }[]) =>
  Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100;

const money = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hm = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ_BR, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Três tabelas do fechamento de caixa para o PDF geral. Retorna a posição final em Y. */
export function addCashReportTables(doc: jsPDF, table: typeof autoTable, caixa: CashData, startY: number): number {
  const methods = Object.entries(caixa.by_method).sort((a, b) => b[1].amount - a[1].amount);
  table(doc, {
    startY, theme: 'grid', margin: { left: 40, right: 40 },
    head: [['Forma', 'Lançamentos', 'Em vendas na hora', 'Em contas a receber', 'Total']],
    body: [
      ...methods.map(([m, v]) => [CASH_METHOD_LABEL[m] || m, String(v.count), money(v.sales_amount), money(v.receivables_amount), money(v.amount)]),
      ['TOTAL QUE ENTROU', '', '', '', money(caixa.total)],
    ],
    headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 8 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });
  let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  table(doc, {
    startY: y, theme: 'striped', margin: { left: 40, right: 40 },
    head: [['Hora', 'Tipo', 'Cliente', 'Vendedor(a)', 'Forma', 'Valor']],
    body: caixa.entries.map(e => [
      hm(e.time),
      e.kind === 'venda' ? 'Venda na hora' : 'Conta a receber',
      e.customer, e.seller, CASH_METHOD_LABEL[e.method] || e.method, money(e.amount),
    ]),
    headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 8, overflow: 'linebreak' },
    columnStyles: { 5: { halign: 'right' } },
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  if (caixa.open_sales.length) {
    table(doc, {
      startY: y, theme: 'striped', margin: { left: 40, right: 40 },
      head: [['Venda', 'Cliente', 'Vendedor(a)', 'Total', 'Ficou em aberto', 'Ainda em aberto']],
      body: caixa.open_sales.map(o => [
        hm(o.time), o.customer, o.seller, money(o.net), money(o.open_at_sale), money(o.pending_now),
      ]),
      headStyles: { fillColor: [217, 119, 6] }, styles: { fontSize: 8, overflow: 'linebreak' },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }
  return y;
}
