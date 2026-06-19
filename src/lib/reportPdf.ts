import { supabase } from '@/integrations/supabase/client';

export interface PdfRow { [k: string]: string | number }

export interface PdfReportConfig {
  title: string;
  subtitle?: string;
  storeId: string;
  columns: { header: string; key: string; width?: number; align?: 'left' | 'right' | 'center' }[];
  rows: PdfRow[];
  footerNote?: string;
}

async function fetchStoreHeader(storeId: string) {
  const { data } = await supabase
    .from('stores')
    .select('name, trade_name, cnpj, city, state, phone, email')
    .eq('id', storeId)
    .maybeSingle();
  return data;
}

export async function generateReportPdf(cfg: PdfReportConfig) {
  const [{ default: jsPDF }, autoTable] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const store = await fetchStoreHeader(cfg.storeId);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(store?.trade_name || store?.name || 'Estokfy', 40, 40);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const headerLine = [
    store?.cnpj && `CNPJ: ${store.cnpj}`,
    store?.city && store?.state && `${store.city}/${store.state}`,
    store?.phone,
  ].filter(Boolean).join(' • ');
  if (headerLine) doc.text(headerLine, 40, 56);

  // Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(cfg.title, 40, 90);
  if (cfg.subtitle) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110);
    doc.text(cfg.subtitle, 40, 106);
    doc.setTextColor(0);
  }

  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageW - 40, 40, { align: 'right' });
  doc.setTextColor(0);

  // Table
  (autoTable as any).default(doc, {
    startY: cfg.subtitle ? 120 : 105,
    head: [cfg.columns.map(c => c.header)],
    body: cfg.rows.map(r => cfg.columns.map(c => String(r[c.key] ?? '—'))),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [59, 130, 246], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: cfg.columns.reduce((acc, c, i) => {
      acc[i] = { halign: c.align || 'left', cellWidth: c.width || 'auto' };
      return acc;
    }, {} as Record<number, any>),
    margin: { left: 40, right: 40 },
    didDrawPage: (data: any) => {
      const str = `Página ${doc.getNumberOfPages()}`;
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(str, pageW - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
      if (cfg.footerNote) doc.text(cfg.footerNote, 40, doc.internal.pageSize.getHeight() - 20);
    },
  });

  const safeName = cfg.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ===== Filtros prontos =====

export async function exportLowStockPdf(storeId: string) {
  const { data } = await supabase.rpc('product_analytics', { p_store_id: storeId });
  const rows = (data || [])
    .filter((p: any) => p.minimum_stock > 0 && p.on_hand <= p.minimum_stock)
    .map((p: any) => ({
      name: p.name,
      on_hand: p.on_hand,
      minimum_stock: p.minimum_stock,
      daily_avg: Number(p.daily_avg || 0).toFixed(2),
      days_to_empty: p.days_to_empty ? Math.round(Number(p.days_to_empty)) : '—',
    }));
  await generateReportPdf({
    title: 'Relatório de Estoque Baixo',
    subtitle: `${rows.length} produto(s) abaixo do estoque mínimo`,
    storeId,
    columns: [
      { header: 'Produto', key: 'name' },
      { header: 'Estoque', key: 'on_hand', align: 'right', width: 60 },
      { header: 'Mínimo', key: 'minimum_stock', align: 'right', width: 60 },
      { header: 'Méd/dia', key: 'daily_avg', align: 'right', width: 60 },
      { header: 'Dias p/ zerar', key: 'days_to_empty', align: 'right', width: 80 },
    ],
    rows,
    footerNote: 'Estokfy • Estoque baixo',
  });
}

export async function exportLowMarginPdf(storeId: string, threshold = 15) {
  const { data } = await supabase.rpc('product_analytics', { p_store_id: storeId });
  const rows = (data || [])
    .filter((p: any) => Number(p.sale_price) > 0 && Number(p.margin_pct) < threshold)
    .sort((a: any, b: any) => Number(a.margin_pct) - Number(b.margin_pct))
    .map((p: any) => ({
      name: p.name,
      cost: `R$ ${Number(p.cost_price).toFixed(2)}`,
      price: `R$ ${Number(p.sale_price).toFixed(2)}`,
      margin: `${Number(p.margin_pct).toFixed(1)}%`,
      sold30: Number(p.qty_sold_30d || 0),
    }));
  await generateReportPdf({
    title: 'Relatório de Margem Baixa',
    subtitle: `${rows.length} produto(s) com margem abaixo de ${threshold}%`,
    storeId,
    columns: [
      { header: 'Produto', key: 'name' },
      { header: 'Custo', key: 'cost', align: 'right', width: 70 },
      { header: 'Preço', key: 'price', align: 'right', width: 70 },
      { header: 'Margem', key: 'margin', align: 'right', width: 70 },
      { header: 'Vendido 30d', key: 'sold30', align: 'right', width: 80 },
    ],
    rows,
    footerNote: 'Estokfy • Margem baixa',
  });
}

export async function exportOverduePdf(storeId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const [recvRes, payRes] = await Promise.all([
    supabase.from('sales')
      .select('id, due_date, amount_pending, customers(name)')
      .eq('store_id', storeId)
      .is('deleted_at', null)
      .in('payment_status', ['pending', 'partial'])
      .lt('due_date', today),
    supabase.from('accounts_payable')
      .select('id, description, due_date, amount, suppliers(name)')
      .eq('store_id', storeId)
      .eq('status', 'pending')
      .lt('due_date', today),
  ]);

  const rows = [
    ...(recvRes.data || []).map((s: any) => ({
      tipo: 'A receber',
      descricao: s.customers?.name || `Venda ${String(s.id).slice(0, 8)}`,
      vencimento: new Date(s.due_date + 'T00:00').toLocaleDateString('pt-BR'),
      valor: `R$ ${Number(s.amount_pending).toFixed(2)}`,
    })),
    ...(payRes.data || []).map((p: any) => ({
      tipo: 'A pagar',
      descricao: p.description + (p.suppliers?.name ? ` (${p.suppliers.name})` : ''),
      vencimento: new Date(p.due_date + 'T00:00').toLocaleDateString('pt-BR'),
      valor: `R$ ${Number(p.amount).toFixed(2)}`,
    })),
  ];

  await generateReportPdf({
    title: 'Relatório de Vencidos',
    subtitle: `${rows.length} item(ns) em atraso`,
    storeId,
    columns: [
      { header: 'Tipo', key: 'tipo', width: 80 },
      { header: 'Descrição', key: 'descricao' },
      { header: 'Vencimento', key: 'vencimento', align: 'center', width: 90 },
      { header: 'Valor', key: 'valor', align: 'right', width: 90 },
    ],
    rows,
    footerNote: 'Estokfy • Vencidos',
  });
}

export async function exportIdleProductsPdf(storeId: string, daysIdle = 60) {
  const { data } = await supabase.rpc('product_analytics', { p_store_id: storeId });
  const rows = (data || [])
    .filter((p: any) => p.on_hand > 0 && (p.days_idle == null || p.days_idle >= daysIdle))
    .sort((a: any, b: any) => (Number(b.days_idle || 9999)) - (Number(a.days_idle || 9999)))
    .map((p: any) => ({
      name: p.name,
      on_hand: p.on_hand,
      idle: p.days_idle ?? 'sem venda',
      acao: suggestIdleAction(p),
    }));
  await generateReportPdf({
    title: 'Produtos Parados',
    subtitle: `${rows.length} produto(s) sem venda há ${daysIdle}+ dias`,
    storeId,
    columns: [
      { header: 'Produto', key: 'name' },
      { header: 'Estoque', key: 'on_hand', align: 'right', width: 60 },
      { header: 'Dias parado', key: 'idle', align: 'right', width: 80 },
      { header: 'Ação sugerida', key: 'acao', width: 160 },
    ],
    rows,
    footerNote: 'Estokfy • Produtos parados',
  });
}

export function suggestIdleAction(p: any): string {
  const idle = p.days_idle ?? 9999;
  const margin = Number(p.margin_pct || 0);
  if (idle >= 180) return '🔥 Liquidar com desconto 30%+';
  if (idle >= 120) return '💰 Promoção / kit combinado';
  if (idle >= 90) return margin > 25 ? '📉 Reduzir 10–15%' : '🤝 Devolver ao fornecedor';
  return '📊 Monitorar 30 dias';
}
