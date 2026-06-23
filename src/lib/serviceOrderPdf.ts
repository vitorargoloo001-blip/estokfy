import { jsPDF } from 'jspdf';
import { formatBRL, SO_STATUS_LABEL, ServiceOrderStatus } from './serviceOrderStatus';

interface SOEquipment {
  device: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  inventory_number?: string | null;
  condition?: string | null;
  accessories?: string | null;
}

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
    delivered_at?: string | null;
    labor_amount: number;
    parts_amount: number;
    travel_cost?: number | null;
    toll_cost?: number | null;
    km_driven?: number | null;
    km_rate?: number | null;
    other_costs?: number | null;
    other_costs_desc?: string | null;
    discount: number;
    total_amount: number;
    paid_amount: number;
    pending_amount: number;
    warranty_days?: number | null;
    warranty_description?: string | null;
    executed_services_notes?: string | null;
    technician_signature_url?: string | null;
    client_signature_url?: string | null;
    terms_snapshot?: string | null;
    is_pro?: boolean;
  };
  items: { item_type: 'service' | 'part'; description: string; qty: number; unit_price: number; total: number }[];
  equipments?: SOEquipment[];
  technicianName?: string | null;
}

const LINE = 5;
const PAGE_W = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setFillColor(245, 245, 245);
  doc.rect(MARGIN, y - 4, CONTENT_W, 6, 'F');
  doc.setTextColor(60, 60, 60);
  doc.text(text.toUpperCase(), MARGIN + 2, y);
  doc.setTextColor(0, 0, 0);
  return y + 5;
}

function infoRow(doc: jsPDF, label: string, value: string, y: number, labelW = 40): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(label + ':', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(value, CONTENT_W - labelW);
  doc.text(lines, MARGIN + labelW, y);
  return y + Math.max(lines.length * 4, LINE);
}

function checkPage(doc: jsPDF, y: number, needed = 14): number {
  if (y + needed > 272) {
    doc.addPage();
    return 18;
  }
  return y;
}

export function generateServiceOrderPDF(p: SOPdfPayload): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  // ── HEADER ──────────────────────────────────────────────
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, PAGE_W, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(p.store?.name || 'Estokfy', MARGIN, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const storeInfo = [p.store?.address, p.store?.phone ? `Tel: ${p.store.phone}` : null].filter(Boolean).join('  •  ');
  if (storeInfo) doc.text(storeInfo, MARGIN, 17);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`OS #${String(p.os.os_number).padStart(5, '0')}`, PAGE_W - MARGIN, 10, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`${SO_STATUS_LABEL[p.os.status]}  •  Entrada: ${new Date(p.os.entry_date).toLocaleDateString('pt-BR')}`, PAGE_W - MARGIN, 16, { align: 'right' });
  if (p.os.estimated_delivery) {
    doc.text(`Previsão: ${new Date(p.os.estimated_delivery).toLocaleDateString('pt-BR')}`, PAGE_W - MARGIN, 22, { align: 'right' });
  }

  doc.setTextColor(0, 0, 0);
  y = 36;

  // ── CLIENTE ─────────────────────────────────────────────
  y = sectionTitle(doc, 'Dados do cliente', y);
  y = infoRow(doc, 'Nome', p.os.customer_name, y);
  if (p.os.customer_phone) y = infoRow(doc, 'Telefone', p.os.customer_phone, y);
  y += 3;

  // ── EQUIPAMENTOS ─────────────────────────────────────────
  const equipList: SOEquipment[] = p.equipments && p.equipments.length > 0
    ? p.equipments
    : [{ device: p.os.device, brand: p.os.brand, model: p.os.model, serial_number: p.os.imei_serial, condition: p.os.device_condition, accessories: p.os.accessories }];

  y = checkPage(doc, y, 20);
  y = sectionTitle(doc, equipList.length > 1 ? `Equipamentos (${equipList.length})` : 'Equipamento', y);

  equipList.forEach((eq, idx) => {
    if (equipList.length > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(`#${idx + 1}`, MARGIN, y);
      y += 4;
    }
    const deviceStr = [eq.device, eq.brand, eq.model].filter(Boolean).join(' ');
    y = infoRow(doc, 'Aparelho', deviceStr, y);
    if (eq.serial_number) y = infoRow(doc, 'Serial / IMEI', eq.serial_number, y);
    if (eq.inventory_number) y = infoRow(doc, 'Patrimônio', eq.inventory_number, y);
    if (eq.condition) y = infoRow(doc, 'Estado', eq.condition, y);
    if (eq.accessories) y = infoRow(doc, 'Acessórios', eq.accessories, y);
    if (idx < equipList.length - 1) y += 2;
  });
  y += 3;

  // ── DEFEITO / SOLICITAÇÃO ─────────────────────────────────
  y = checkPage(doc, y, 20);
  y = sectionTitle(doc, 'Defeito relatado / Solicitação', y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const issueLines = doc.splitTextToSize(p.os.reported_issue, CONTENT_W);
  doc.text(issueLines, MARGIN, y);
  y += issueLines.length * 4 + 5;

  // ── SERVIÇOS EXECUTADOS ───────────────────────────────────
  if (p.os.executed_services_notes) {
    y = checkPage(doc, y, 16);
    y = sectionTitle(doc, 'Serviços executados', y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const notesLines = doc.splitTextToSize(p.os.executed_services_notes, CONTENT_W);
    doc.text(notesLines, MARGIN, y);
    y += notesLines.length * 4 + 5;
  }

  // ── SERVIÇOS E PEÇAS (tabela) ─────────────────────────────
  if (p.items.length > 0) {
    y = checkPage(doc, y, 20);
    y = sectionTitle(doc, 'Serviços e peças', y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setFillColor(235, 235, 235);
    doc.rect(MARGIN, y - 3.5, CONTENT_W, 5.5, 'F');
    doc.text('Descrição', MARGIN + 1, y);
    doc.text('Tipo', 125, y);
    doc.text('Qtd', 148, y);
    doc.text('Unit.', 161, y);
    doc.text('Total', PAGE_W - MARGIN, y, { align: 'right' });
    y += 3;
    doc.setDrawColor(200);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 3;

    doc.setFont('helvetica', 'normal');
    p.items.forEach(it => {
      y = checkPage(doc, y, 6);
      const descLines = doc.splitTextToSize(it.description, 108);
      doc.text(descLines, MARGIN + 1, y);
      doc.text(it.item_type === 'part' ? 'Peça' : 'Serviço', 125, y);
      doc.text(String(it.qty), 148, y);
      doc.text(formatBRL(it.unit_price), 161, y);
      doc.text(formatBRL(it.total), PAGE_W - MARGIN, y, { align: 'right' });
      y += Math.max(descLines.length * 4, LINE);
    });
    y += 2;
  }

  // ── VALORES ───────────────────────────────────────────────
  y = checkPage(doc, y, 40);
  y = sectionTitle(doc, 'Valores', y);

  const valueCol = 145;
  const valueRow = (label: string, val: string, bold = false, color?: [number,number,number]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    if (color) doc.setTextColor(...color);
    doc.text(label, valueCol, y);
    doc.text(val, PAGE_W - MARGIN, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += LINE;
  };

  if (p.os.labor_amount > 0) valueRow('Mão de obra:', formatBRL(p.os.labor_amount));
  if (p.os.parts_amount > 0) valueRow('Peças / Materiais:', formatBRL(p.os.parts_amount));

  const travel = p.os.travel_cost || 0;
  const toll = p.os.toll_cost || 0;
  const kmAmt = (p.os.km_driven || 0) * (p.os.km_rate || 0);
  const other = p.os.other_costs || 0;

  if (travel > 0) valueRow('Deslocamento:', formatBRL(travel));
  if (toll > 0) valueRow('Pedágio:', formatBRL(toll));
  if (kmAmt > 0) valueRow(`Km rodado (${p.os.km_driven} km × ${formatBRL(p.os.km_rate || 0)}/km):`, formatBRL(kmAmt));
  if (other > 0) valueRow(`Outros${p.os.other_costs_desc ? ` (${p.os.other_costs_desc})` : ''}:`, formatBRL(other));
  if (p.os.discount > 0) valueRow('Desconto:', '- ' + formatBRL(p.os.discount));

  doc.setDrawColor(180);
  doc.line(valueCol, y - 1, PAGE_W - MARGIN, y - 1);
  valueRow('TOTAL:', formatBRL(p.os.total_amount), true);
  valueRow('Pago:', formatBRL(p.os.paid_amount));
  valueRow(
    'Pendente:',
    formatBRL(p.os.pending_amount),
    true,
    p.os.pending_amount > 0 ? [180, 30, 30] : [30, 130, 50]
  );
  y += 3;

  // ── GARANTIA ─────────────────────────────────────────────
  if (p.os.warranty_days && p.os.warranty_days > 0) {
    y = checkPage(doc, y, 14);
    y = sectionTitle(doc, 'Garantia', y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const warrantyText = p.os.warranty_description
      ? p.os.warranty_description
      : `${p.os.warranty_days} dias a partir da data de entrega.`;

    if (p.os.delivered_at) {
      const deliveryDate = new Date(p.os.delivered_at);
      const expiryDate = new Date(deliveryDate);
      expiryDate.setDate(expiryDate.getDate() + p.os.warranty_days);
      doc.text(
        `Garantia: ${p.os.warranty_days} dias  •  Válida até: ${expiryDate.toLocaleDateString('pt-BR')}`,
        MARGIN, y
      );
      y += 4;
    } else {
      doc.text(`Garantia: ${p.os.warranty_days} dias após a entrega.`, MARGIN, y);
      y += 4;
    }
    if (p.os.warranty_description) {
      const wLines = doc.splitTextToSize(warrantyText, CONTENT_W);
      doc.text(wLines, MARGIN, y);
      y += wLines.length * 4;
    }
    y += 3;
  }

  // ── TERMOS ───────────────────────────────────────────────
  if (p.os.terms_snapshot) {
    y = checkPage(doc, y, 16);
    y = sectionTitle(doc, 'Termos e condições', y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(80, 80, 80);
    const termLines = doc.splitTextToSize(p.os.terms_snapshot, CONTENT_W);
    doc.text(termLines, MARGIN, y);
    doc.setTextColor(0, 0, 0);
    y += termLines.length * 3.5 + 5;
  }

  // ── TÉCNICO ──────────────────────────────────────────────
  if (p.technicianName) {
    y = checkPage(doc, y, 8);
    y = sectionTitle(doc, 'Técnico responsável', y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(p.technicianName, MARGIN, y);
    y += 7;
  }

  // ── ASSINATURAS ──────────────────────────────────────────
  y = checkPage(doc, y, 50);
  y = sectionTitle(doc, 'Assinaturas', y);
  y += 2;

  const sigW = 78;
  const sigH = 28;
  const sigY = y;

  // Caixa técnico
  doc.setDrawColor(180);
  doc.rect(MARGIN, sigY, sigW, sigH);
  if (p.os.technician_signature_url && p.os.technician_signature_url.startsWith('data:image')) {
    try { doc.addImage(p.os.technician_signature_url, 'PNG', MARGIN + 1, sigY + 1, sigW - 2, sigH - 2); } catch { /* skip */ }
  }

  // Caixa cliente
  doc.rect(PAGE_W - MARGIN - sigW, sigY, sigW, sigH);
  if (p.os.client_signature_url && p.os.client_signature_url.startsWith('data:image')) {
    try { doc.addImage(p.os.client_signature_url, 'PNG', PAGE_W - MARGIN - sigW + 1, sigY + 1, sigW - 2, sigH - 2); } catch { /* skip */ }
  }

  y = sigY + sigH + 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Assinatura do Técnico', MARGIN + sigW / 2, y, { align: 'center' });
  doc.text('Assinatura do Cliente', PAGE_W - MARGIN - sigW / 2, y, { align: 'center' });

  y += 8;

  // ── RODAPÉ ───────────────────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    doc.text(
      `${p.store?.name || 'Estokfy'}  •  OS #${String(p.os.os_number).padStart(5, '0')}  •  Página ${i}/${pageCount}`,
      PAGE_W / 2, 290, { align: 'center' }
    );
    doc.setTextColor(0, 0, 0);
  }

  return doc;
}
