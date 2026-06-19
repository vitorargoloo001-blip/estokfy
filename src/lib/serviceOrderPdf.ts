import { jsPDF } from 'jspdf';
import { formatBRL, SO_STATUS_LABEL, ServiceOrderStatus } from './serviceOrderStatus';

interface SOPdfPayload {
  store: { name?: string | null; phone?: string | null; address?: string | null } | null;
  os: {
    os_number: number;
    customer_name: string;
    customer_phone?: string | null;
    device: string;
    brand?: string | null;
    model?: string | null;
    imei_serial?: string | null;
    device_condition?: string | null;
    reported_issue: string;
    accessories?: string | null;
    status: ServiceOrderStatus;
    entry_date: string;
    estimated_delivery?: string | null;
    labor_amount: number;
    parts_amount: number;
    discount: number;
    total_amount: number;
    paid_amount: number;
    pending_amount: number;
    terms_snapshot?: string | null;
  };
  items: { item_type: 'service' | 'part'; description: string; qty: number; unit_price: number; total: number }[];
}

export function generateServiceOrderPDF(p: SOPdfPayload): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  let y = 14;

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(p.store?.name || 'Estokfy', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (p.store?.address) { y += 5; doc.text(p.store.address, 14, y); }
  if (p.store?.phone) { y += 4; doc.text(`Tel: ${p.store.phone}`, 14, y); }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`ORDEM DE SERVIÇO #${String(p.os.os_number).padStart(5, '0')}`, W - 14, 16, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Status: ${SO_STATUS_LABEL[p.os.status]}`, W - 14, 22, { align: 'right' });
  doc.text(`Entrada: ${new Date(p.os.entry_date).toLocaleDateString('pt-BR')}`, W - 14, 27, { align: 'right' });
  if (p.os.estimated_delivery) doc.text(`Previsão: ${new Date(p.os.estimated_delivery).toLocaleDateString('pt-BR')}`, W - 14, 32, { align: 'right' });

  y = 42;
  doc.setDrawColor(200); doc.line(14, y, W - 14, y); y += 6;

  // Customer
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('CLIENTE', 14, y); y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`${p.os.customer_name}${p.os.customer_phone ? ' — ' + p.os.customer_phone : ''}`, 14, y);
  y += 7;

  // Device
  doc.setFont('helvetica', 'bold');
  doc.text('APARELHO', 14, y); y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`${p.os.device} ${p.os.brand || ''} ${p.os.model || ''}`.trim(), 14, y); y += 4;
  if (p.os.imei_serial) { doc.text(`IMEI/Serial: ${p.os.imei_serial}`, 14, y); y += 4; }
  if (p.os.device_condition) { doc.text(`Estado: ${p.os.device_condition}`, 14, y); y += 4; }
  if (p.os.accessories) { doc.text(`Acessórios: ${p.os.accessories}`, 14, y); y += 4; }
  y += 3;

  // Issue
  doc.setFont('helvetica', 'bold'); doc.text('DEFEITO RELATADO', 14, y); y += 5;
  doc.setFont('helvetica', 'normal');
  const issueLines = doc.splitTextToSize(p.os.reported_issue, W - 28);
  doc.text(issueLines, 14, y); y += issueLines.length * 4 + 4;

  // Items table
  doc.setFont('helvetica', 'bold'); doc.text('SERVIÇOS E PEÇAS', 14, y); y += 5;
  doc.setFontSize(9);
  doc.text('Descrição', 14, y); doc.text('Qtd', 130, y); doc.text('Unit.', 150, y); doc.text('Total', W - 14, y, { align: 'right' });
  y += 2; doc.line(14, y, W - 14, y); y += 4;
  doc.setFont('helvetica', 'normal');
  p.items.forEach(it => {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.text(`${it.item_type === 'part' ? '[Peça] ' : '[Serviço] '}${it.description}`.slice(0, 65), 14, y);
    doc.text(String(it.qty), 130, y);
    doc.text(formatBRL(it.unit_price), 150, y);
    doc.text(formatBRL(it.total), W - 14, y, { align: 'right' });
    y += 5;
  });
  y += 2; doc.line(14, y, W - 14, y); y += 6;

  // Totals
  doc.setFontSize(10);
  const row = (label: string, val: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, 130, y); doc.text(val, W - 14, y, { align: 'right' }); y += 5;
  };
  row('Mão de obra:', formatBRL(p.os.labor_amount));
  row('Peças:', formatBRL(p.os.parts_amount));
  if (p.os.discount > 0) row('Desconto:', '- ' + formatBRL(p.os.discount));
  row('TOTAL:', formatBRL(p.os.total_amount), true);
  row('Pago:', formatBRL(p.os.paid_amount));
  row('Pendente:', formatBRL(p.os.pending_amount), p.os.pending_amount > 0);
  y += 4;

  // Terms
  if (p.os.terms_snapshot) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('TERMOS', 14, y); y += 4;
    doc.setFont('helvetica', 'normal');
    const t = doc.splitTextToSize(p.os.terms_snapshot, W - 28);
    doc.text(t, 14, y); y += t.length * 3.5 + 8;
  }

  // Signatures
  if (y > 250) { doc.addPage(); y = 240; }
  y = Math.max(y, 250);
  doc.setFontSize(9);
  doc.line(20, y, 90, y); doc.line(120, y, 190, y); y += 4;
  doc.text('Assinatura do Cliente', 30, y); doc.text('Assinatura da Loja', 135, y);

  return doc;
}
