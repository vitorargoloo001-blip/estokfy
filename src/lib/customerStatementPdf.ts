import { jsPDF } from 'jspdf';

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface StatementSale {
  id: string;
  created_at: string;
  due_date: string | null;
  net_total: number;
  amount_paid: number;
  amount_pending: number;
  payment_status: string;
  description: string;
  overdue: boolean;
}

export interface StatementPayload {
  store: { name?: string | null; phone?: string | null; address?: string | null } | null;
  customer: { name: string; phone?: string | null };
  sales: StatementSale[];
  onlyOverdue: boolean;
}

export function generateCustomerStatementPDF(p: StatementPayload): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const today = new Date();
  const emissionDate = today.toLocaleDateString('pt-BR');
  let y = 14;

  // Header / brand bar
  doc.setFillColor(59, 130, 246);
  doc.rect(0, 0, W, 4, 'F');

  y = 14;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(p.store?.name || 'Estokfy', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (p.store?.address) { y += 5; doc.text(p.store.address, 14, y); }
  if (p.store?.phone) { y += 4; doc.text(`Tel: ${p.store.phone}`, 14, y); }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('EXTRATO DE DÉBITOS', W - 14, 16, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Emissão: ${emissionDate}`, W - 14, 22, { align: 'right' });
  if (p.onlyOverdue) doc.text('Filtro: Apenas vencidas', W - 14, 27, { align: 'right' });

  y = 38;
  doc.setDrawColor(220); doc.line(14, y, W - 14, y); y += 6;

  const totalPending = p.sales.reduce((s, r) => s + Number(r.amount_pending), 0);

  // Customer block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('CLIENTE', 14, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(p.customer.name, 14, y); y += 4;
  if (p.customer.phone) { doc.text(`Telefone: ${p.customer.phone}`, 14, y); y += 4; }
  doc.text(`Títulos pendentes: ${p.sales.length}`, 14, y); y += 4;

  // Total badge right side
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('TOTAL EM ABERTO', W - 14, y - 12, { align: 'right' });
  doc.setFontSize(16);
  doc.setTextColor(220, 38, 38);
  doc.text(fmt(totalPending), W - 14, y - 5, { align: 'right' });
  doc.setTextColor(0);

  y += 4;
  doc.setDrawColor(220); doc.line(14, y, W - 14, y); y += 6;

  // Table header
  doc.setFillColor(245, 247, 250);
  doc.rect(14, y - 4, W - 28, 7, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('Data', 16, y);
  doc.text('Produto', 38, y);
  doc.text('Vencim.', 104, y);
  doc.text('Total', 130, y, { align: 'right' });
  doc.text('Recebido', 152, y, { align: 'right' });
  doc.text('Pendente', 178, y, { align: 'right' });
  doc.text('Status', W - 16, y, { align: 'right' });
  y += 5;
  doc.setDrawColor(230); doc.line(14, y - 1, W - 14, y - 1);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  p.sales.forEach((s) => {
    if (y > 265) {
      doc.addPage(); y = 20;
    }
    const date = new Date(s.created_at).toLocaleDateString('pt-BR');
    const due = s.due_date ? new Date(s.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
    const status = s.overdue ? 'Vencida' : s.payment_status === 'partial' ? 'Parcial' : 'Pendente';
    const desc = (s.description || 'Venda').slice(0, 40);

    doc.text(date, 16, y);
    doc.text(desc, 38, y);
    doc.text(due, 104, y);
    doc.text(fmt(s.net_total), 130, y, { align: 'right' });
    doc.text(fmt(s.amount_paid), 152, y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(s.amount_pending), 178, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    if (s.overdue) doc.setTextColor(220, 38, 38);
    doc.text(status, W - 16, y, { align: 'right' });
    doc.setTextColor(0);
    y += 5;
  });

  y += 2;
  doc.setDrawColor(200); doc.line(14, y, W - 14, y); y += 7;

  // Summary
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Total em aberto:', 130, y, { align: 'right' });
  doc.setTextColor(220, 38, 38);
  doc.text(fmt(totalPending), W - 14, y, { align: 'right' });
  doc.setTextColor(0);
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Quantidade de títulos:', 130, y, { align: 'right' });
  doc.text(String(p.sales.length), W - 14, y, { align: 'right' });
  y += 10;

  // Observation
  doc.setFontSize(8); doc.setTextColor(90);
  const obs = 'Este documento apresenta os valores atualmente pendentes em nosso sistema na data de emissão.';
  const obsLines = doc.splitTextToSize(obs, W - 28);
  doc.text(obsLines, 14, y);
  doc.setTextColor(0);

  // Footer
  doc.setFontSize(7); doc.setTextColor(150);
  doc.text(`${p.store?.name || 'Estokfy'} — Extrato gerado em ${emissionDate}`, W / 2, 290, { align: 'center' });

  return doc;
}

export function statementFileName(customerName: string): string {
  const safe = customerName
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  return `Extrato_${safe || 'Cliente'}_${date}.pdf`;
}
