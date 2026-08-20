import { jsPDF } from 'jspdf';

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface StatementItem {
  name: string;
  qty: number;
  unit_price: number;
  amount_paid: number;
  amount_pending: number;
}

export interface StatementSale {
  id: string;
  created_at: string;
  due_date: string | null;
  net_total: number;
  amount_paid: number;
  amount_pending: number;
  payment_status: string;
  overdue: boolean;
  items: StatementItem[];
}

export interface StatementPayload {
  store: { name?: string | null; phone?: string | null; address?: string | null } | null;
  customer: { name: string; phone?: string | null };
  sales: StatementSale[];
  onlyOverdue: boolean;
}

const PAGE_H = 297;
const MARGIN = 14;
const W = 210;
const MAX_Y = PAGE_H - 18;

const C_DESC  = MARGIN + 4;
const C_QTY   = 96;
const C_UNIT  = 120;
const C_PAID  = 152;
const C_PEND  = 182;
const C_RIGHT = W - MARGIN;

export function generateCustomerStatementPDF(p: StatementPayload): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const today = new Date();
  const emissionDate = today.toLocaleDateString('pt-BR');
  let y = 14;

  const newPage = () => { doc.addPage(); y = 20; };
  const checkY = (needed: number) => { if (y + needed > MAX_Y) newPage(); };

  // Brand bar
  doc.setFillColor(59, 130, 246);
  doc.rect(0, 0, W, 4, 'F');

  y = 14;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(p.store?.name || 'Estokfy', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (p.store?.address) { y += 5; doc.text(p.store.address, MARGIN, y); }
  if (p.store?.phone)   { y += 4; doc.text(`Tel: ${p.store.phone}`, MARGIN, y); }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('EXTRATO DE DÉBITOS', C_RIGHT, 16, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Emissão: ${emissionDate}`, C_RIGHT, 22, { align: 'right' });
  if (p.onlyOverdue) doc.text('Filtro: Apenas vencidas', C_RIGHT, 27, { align: 'right' });

  y = 38;
  doc.setDrawColor(220); doc.line(MARGIN, y, C_RIGHT, y); y += 6;

  const totalPending = p.sales.reduce((s, r) => s + Number(r.amount_pending), 0);

  // Customer block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('CLIENTE', MARGIN, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(p.customer.name, MARGIN, y); y += 4;
  if (p.customer.phone) { doc.text(`Telefone: ${p.customer.phone}`, MARGIN, y); y += 4; }
  doc.text(`Pendências: ${p.sales.length} venda(s)`, MARGIN, y); y += 4;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('TOTAL EM ABERTO', C_RIGHT, y - 12, { align: 'right' });
  doc.setFontSize(16);
  doc.setTextColor(220, 38, 38);
  doc.text(fmt(totalPending), C_RIGHT, y - 5, { align: 'right' });
  doc.setTextColor(0);

  y += 4;
  doc.setDrawColor(200); doc.line(MARGIN, y, C_RIGHT, y); y += 5;

  // Column headers
  doc.setFillColor(245, 247, 250);
  doc.rect(MARGIN, y - 3, W - MARGIN * 2, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  doc.setTextColor(80);
  doc.text('PRODUTO', C_DESC, y);
  doc.text('QTD', C_QTY, y, { align: 'right' });
  doc.text('UNIT.', C_UNIT, y, { align: 'right' });
  doc.text('RECEBIDO', C_PAID, y, { align: 'right' });
  doc.text('A RECEBER', C_PEND, y, { align: 'right' });
  doc.setTextColor(0);
  y += 5;
  doc.setDrawColor(220); doc.line(MARGIN, y - 1, C_RIGHT, y - 1);

  // Sales (newest first)
  const sortedSales = [...p.sales].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  for (const s of sortedSales) {
    const date   = new Date(s.created_at).toLocaleDateString('pt-BR');
    const due    = s.due_date ? new Date(s.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
    const status = s.overdue ? 'VENCIDA' : s.payment_status === 'partial' ? 'PARCIAL' : 'PENDENTE';
    const items  = s.items || [];

    checkY(8 + items.length * 5 + 22);

    // Sale header bar
    doc.setFillColor(237, 242, 250);
    doc.rect(MARGIN, y - 3, W - MARGIN * 2, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(30);
    doc.text(`Venda #${s.id.slice(0, 8).toUpperCase()} · ${date}`, C_DESC, y);
    if (s.overdue) doc.setTextColor(200, 30, 30);
    doc.text(`Venc: ${due}   ${status}`, C_RIGHT, y, { align: 'right' });
    doc.setTextColor(0);
    y += 7;

    // Item rows
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    for (const it of items) {
      checkY(6);
      const name = (doc.splitTextToSize(it.name, 68) as string[])[0];
      doc.text(name, C_DESC, y);
      doc.text(String(it.qty), C_QTY, y, { align: 'right' });
      doc.text(fmt(it.unit_price), C_UNIT, y, { align: 'right' });
      doc.setTextColor(22, 163, 74);
      doc.text(fmt(it.amount_paid), C_PAID, y, { align: 'right' });
      doc.setTextColor(it.amount_pending > 0 ? 200 : 0, it.amount_pending > 0 ? 30 : 0, it.amount_pending > 0 ? 30 : 0);
      doc.text(fmt(it.amount_pending), C_PEND, y, { align: 'right' });
      doc.setTextColor(0);
      y += 5;
    }

    // Sale summary
    checkY(16);
    doc.setFontSize(7.5); doc.setTextColor(80);
    doc.text('Total da venda:', 102, y, { align: 'right' });
    doc.setTextColor(0);
    doc.text(fmt(s.net_total), C_PEND, y, { align: 'right' });
    y += 4.5;

    if (s.amount_paid > 0) {
      checkY(6);
      doc.setTextColor(80);
      doc.text('Já recebido:', 102, y, { align: 'right' });
      doc.setTextColor(22, 163, 74);
      doc.text(fmt(s.amount_paid), C_PEND, y, { align: 'right' });
      doc.setTextColor(0);
      y += 4.5;
    }

    checkY(6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(200, 30, 30);
    doc.text('Pendente:', 102, y, { align: 'right' });
    doc.text(fmt(s.amount_pending), C_PEND, y, { align: 'right' });
    doc.setTextColor(0); doc.setFont('helvetica', 'normal');
    y += 3;

    doc.setDrawColor(220); doc.line(MARGIN, y, C_RIGHT, y);
    y += 5;
  }

  // Grand total
  checkY(20);
  doc.setDrawColor(180); doc.line(MARGIN, y - 2, C_RIGHT, y - 2);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('TOTAL EM ABERTO:', C_RIGHT - 48, y + 5);
  doc.setTextColor(220, 38, 38);
  doc.text(fmt(totalPending), C_RIGHT, y + 5, { align: 'right' });
  doc.setTextColor(0);
  y += 12;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.text(`Quantidade de vendas: ${p.sales.length}`, C_RIGHT, y, { align: 'right' });
  y += 8;

  doc.setFontSize(8); doc.setTextColor(90);
  const obs = 'Este documento apresenta os valores atualmente pendentes em nosso sistema na data de emissão.';
  doc.text(doc.splitTextToSize(obs, W - MARGIN * 2), MARGIN, y);
  doc.setTextColor(0);

  doc.setFontSize(7); doc.setTextColor(150);
  doc.text(
    `${p.store?.name || 'Estokfy'} — Extrato gerado em ${emissionDate}`,
    W / 2, PAGE_H - 8, { align: 'center' },
  );

  return doc;
}

export function statementFileName(customerName: string): string {
  const safe = customerName
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  return `Extrato_${safe || 'Cliente'}_${date}.pdf`;
}
