import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface ReceiptItem {
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface ReceiptData {
  storeName: string;
  storePhone?: string | null;
  saleId: string;
  createdAt: string;
  customerName?: string | null;
  sellerName?: string | null;
  notes?: string | null;
  items: ReceiptItem[];
  discount: number;
  shipping: number;
  gross: number;
  net: number;
  amountPaid: number;
  amountPending: number;
  paymentStatus: string;
  paymentMethods: string[];
}

export interface ThermalPrintOptions {
  paperWidth?: '58mm' | '80mm';
  copies?: number;
  showLogo?: boolean;
  showNotes?: boolean;
  footerMessage?: string;
}

export function generateReceiptPdfA4(data: ReceiptData): jsPDF {
  const doc = new jsPDF();
  const dt = new Date(data.createdAt).toLocaleString('pt-BR');

  doc.setFontSize(18);
  doc.text(data.storeName, 14, 18);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Comprovante de Venda • ${dt}`, 14, 24);
  if (data.storePhone) doc.text(`Tel: ${data.storePhone}`, 14, 29);
  doc.setTextColor(0);
  doc.setFontSize(10);
  doc.text(`Venda: ${data.saleId.slice(0, 8).toUpperCase()}`, 14, 36);
  if (data.customerName) doc.text(`Cliente: ${data.customerName}`, 14, 42);

  autoTable(doc, {
    startY: 50,
    head: [['Produto', 'Qtd', 'Unit.', 'Total']],
    body: data.items.map(it => [
      it.name,
      String(it.qty),
      fmtBRL(it.unit_price),
      fmtBRL(it.line_total),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [59, 130, 246] },
  });

  // @ts-expect-error jsPDF lastAutoTable injected by autotable
  let y = (doc.lastAutoTable?.finalY ?? 60) + 8;
  const right = 196;
  doc.setFontSize(10);
  doc.text(`Subtotal: ${fmtBRL(data.gross)}`, right, y, { align: 'right' }); y += 6;
  if (data.discount > 0) { doc.text(`Desconto: -${fmtBRL(data.discount)}`, right, y, { align: 'right' }); y += 6; }
  if (data.shipping > 0) { doc.text(`Frete: ${fmtBRL(data.shipping)}`, right, y, { align: 'right' }); y += 6; }
  doc.setFont(undefined, 'bold');
  doc.text(`Total: ${fmtBRL(data.net)}`, right, y, { align: 'right' }); y += 7;
  doc.setFont(undefined, 'normal');
  doc.text(`Pago: ${fmtBRL(data.amountPaid)}`, right, y, { align: 'right' }); y += 6;
  if (data.amountPending > 0) {
    doc.setTextColor(220, 38, 38);
    doc.text(`Pendente: ${fmtBRL(data.amountPending)}`, right, y, { align: 'right' }); y += 6;
    doc.setTextColor(0);
  }
  doc.text(`Status: ${data.paymentStatus}`, right, y, { align: 'right' }); y += 6;
  if (data.paymentMethods.length) {
    doc.text(`Forma: ${data.paymentMethods.join(', ')}`, right, y, { align: 'right' });
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text('Obrigado pela preferência!', 105, 285, { align: 'center' });

  return doc;
}

/** Texto simples para WhatsApp / cupom térmico */
export function buildReceiptText(data: ReceiptData): string {
  const dt = new Date(data.createdAt).toLocaleString('pt-BR');
  const lines: string[] = [];
  lines.push(`*${data.storeName}*`);
  lines.push(`Comprovante #${data.saleId.slice(0, 8).toUpperCase()}`);
  lines.push(dt);
  if (data.customerName) lines.push(`Cliente: ${data.customerName}`);
  lines.push('');
  lines.push('— Itens —');
  data.items.forEach(it => {
    lines.push(`${it.qty}x ${it.name} — ${fmtBRL(it.line_total)}`);
  });
  lines.push('');
  lines.push(`Subtotal: ${fmtBRL(data.gross)}`);
  if (data.discount > 0) lines.push(`Desconto: -${fmtBRL(data.discount)}`);
  if (data.shipping > 0) lines.push(`Frete: ${fmtBRL(data.shipping)}`);
  lines.push(`*Total: ${fmtBRL(data.net)}*`);
  lines.push(`Pago: ${fmtBRL(data.amountPaid)}`);
  if (data.amountPending > 0) lines.push(`Pendente: ${fmtBRL(data.amountPending)}`);
  lines.push(`Status: ${data.paymentStatus}`);
  if (data.paymentMethods.length) lines.push(`Pagamento: ${data.paymentMethods.join(', ')}`);
  lines.push('');
  lines.push('Obrigado pela preferência!');
  return lines.join('\n');
}

/** HTML para impressão térmica (58mm ou 80mm). */
export function printThermalReceipt(data: ReceiptData, opts: ThermalPrintOptions = {}) {
  const paper = opts.paperWidth || '80mm';
  const copies = Math.max(1, Math.min(5, opts.copies ?? 1));
  const showLogo = opts.showLogo ?? true;
  const showNotes = opts.showNotes ?? true;
  const footer = opts.footerMessage || 'Obrigado pela preferência.';

  const dt = new Date(data.createdAt).toLocaleString('pt-BR');
  const isNarrow = paper === '58mm';
  const bodyWidth = isNarrow ? '54mm' : '72mm';
  const baseFont = isNarrow ? '10px' : '11px';
  const titleFont = isNarrow ? '12px' : '14px';

  const itemsHtml = data.items.map(it => {
    if (isNarrow) {
      return `<div class="item">
        <div class="row"><span class="grow">${escapeHtml(it.name)}</span></div>
        <div class="row muted"><span>${it.qty} x ${fmtBRL(it.unit_price)}</span><span>${fmtBRL(it.line_total)}</span></div>
      </div>`;
    }
    return `<div class="row"><span>${it.qty}x ${escapeHtml(it.name)}</span><span>${fmtBRL(it.line_total)}</span></div>`;
  }).join('');

  const ticket = `
${showLogo ? `<h1>${escapeHtml(data.storeName)}</h1>` : `<div class="bold center">${escapeHtml(data.storeName)}</div>`}
${data.storePhone ? `<div class="muted">${escapeHtml(data.storePhone)}</div>` : ''}
<div class="muted">${dt}</div>
<div class="muted">#${data.saleId.slice(0, 8).toUpperCase()}</div>
${data.sellerName ? `<div>Vendedor: ${escapeHtml(data.sellerName)}</div>` : ''}
${data.customerName ? `<div>Cliente: ${escapeHtml(data.customerName)}</div>` : ''}
<div class="sep"></div>
${itemsHtml}
<div class="sep"></div>
<div class="row"><span>Subtotal</span><span>${fmtBRL(data.gross)}</span></div>
${data.discount > 0 ? `<div class="row"><span>Desconto</span><span>-${fmtBRL(data.discount)}</span></div>` : ''}
${data.shipping > 0 ? `<div class="row"><span>Frete</span><span>${fmtBRL(data.shipping)}</span></div>` : ''}
<div class="row bold"><span>TOTAL</span><span>${fmtBRL(data.net)}</span></div>
<div class="row"><span>Pago</span><span>${fmtBRL(data.amountPaid)}</span></div>
${data.amountPending > 0 ? `<div class="row"><span>Pendente</span><span>${fmtBRL(data.amountPending)}</span></div>` : ''}
<div class="row"><span>Status</span><span>${escapeHtml(statusLabel(data.paymentStatus))}</span></div>
${data.paymentMethods.length ? `<div class="row"><span>Forma</span><span>${escapeHtml(data.paymentMethods.join(', '))}</span></div>` : ''}
${showNotes && data.notes ? `<div class="sep"></div><div class="muted">Obs: ${escapeHtml(data.notes)}</div>` : ''}
<div class="sep"></div>
<div class="muted center">${escapeHtml(footer)}</div>
`;

  const allTickets = Array.from({ length: copies }, (_, i) =>
    `<div class="ticket">${ticket}${i < copies - 1 ? '<div class="cut"></div>' : ''}</div>`
  ).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Comprovante</title>
<style>
@page { size: ${paper} auto; margin: 3mm; }
body { font-family: ui-monospace, monospace; font-size: ${baseFont}; width: ${bodyWidth}; margin: 0; }
h1 { font-size: ${titleFont}; text-align: center; margin: 4px 0; }
.muted { color: #555; font-size: ${isNarrow ? '9px' : '10px'}; }
.center { text-align: center; }
.sep { border-top: 1px dashed #000; margin: 5px 0; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.row .grow { flex: 1; }
.bold { font-weight: 700; }
.item { margin-bottom: 2px; }
.ticket { page-break-after: always; }
.ticket:last-child { page-break-after: auto; }
.cut { border-top: 1px dashed #999; margin: 8px 0; }
</style></head><body>
${allTickets}
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),400);};</script>
</body></html>`;

  const w = window.open('', '_blank', `width=${isNarrow ? 320 : 380},height=600`);
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    paid: 'Pago',
    pending: 'Pendente',
    partial: 'Parcial',
    cancelled: 'Cancelado',
  };
  return map[s] || s;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export function shareWhatsApp(text: string, phone?: string | null) {
  const num = (phone || '').replace(/\D/g, '');
  const url = num
    ? `https://wa.me/${num}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map(r =>
    r.map(c => {
      const s = c == null ? '' : String(c);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')
  ).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
