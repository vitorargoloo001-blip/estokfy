import { supabase } from '@/integrations/supabase/client';

export const FISCAL_BUCKET = 'fiscal-documents';

// Fonte única do padrão no frontend. O valor real vem sempre de
// get_fiscal_summary, que lê store_settings (category 'fiscal',
// chave 'alert_days') e aplica o mesmo padrão no servidor — este
// número só existe para o caso de a RPC não devolver nada.
export const FISCAL_ALERT_DAYS_DEFAULT = 15;

export type FiscalStatus = 'pending' | 'sent_to_accountant' | 'declared' | 'cancelled';
export type FiscalDocumentType = 'nfe' | 'nfce' | 'nfse' | 'entrada' | 'saida' | 'outro';
export type FiscalDirection = 'incoming' | 'outgoing';

export interface FiscalDocumentRow {
  id: string;
  store_id: string;
  sale_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  document_type: FiscalDocumentType;
  direction: FiscalDirection;
  invoice_number: string;
  series: string | null;
  access_key: string | null;
  issue_date: string;
  competence_month: number;
  competence_year: number;
  total_amount: number;
  counterpart_name: string | null;
  counterpart_doc: string | null;
  fiscal_status: FiscalStatus;
  xml_path: string | null;
  pdf_path: string | null;
  notes: string | null;
  sent_to_accountant_at: string | null;
  declared_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface FiscalSummary {
  pending_count: number;
  sent_count: number;
  declared_count: number;
  cancelled_count: number;
  period_count: number;
  pending_amount: number;
  overdue_count: number;
  alert_days: number;
}

export interface FiscalDocumentInput {
  document_type: FiscalDocumentType;
  direction: FiscalDirection;
  invoice_number: string;
  issue_date: string;
  competence_month: number;
  competence_year: number;
  total_amount: number;
  series?: string | null;
  access_key?: string | null;
  sale_id?: string | null;
  customer_id?: string | null;
  supplier_id?: string | null;
  counterpart_name?: string | null;
  counterpart_doc?: string | null;
  xml_path?: string | null;
  pdf_path?: string | null;
  notes?: string | null;
}

export interface FiscalFilters {
  storeId: string;
  status?: FiscalStatus | 'all';
  documentType?: FiscalDocumentType | 'all';
  direction?: FiscalDirection | 'all';
  competenceYear?: number | null;
  competenceMonth?: number | null;
  search?: string;
}

export async function listFiscalDocuments(f: FiscalFilters): Promise<FiscalDocumentRow[]> {
  let q = supabase
    .from('fiscal_documents')
    .select('*')
    .eq('store_id', f.storeId)
    .order('issue_date', { ascending: false })
    .limit(500);

  if (f.status && f.status !== 'all') q = q.eq('fiscal_status', f.status);
  if (f.documentType && f.documentType !== 'all') q = q.eq('document_type', f.documentType);
  if (f.direction && f.direction !== 'all') q = q.eq('direction', f.direction);
  if (f.competenceYear) q = q.eq('competence_year', f.competenceYear);
  if (f.competenceMonth) q = q.eq('competence_month', f.competenceMonth);
  if (f.search?.trim()) {
    const s = f.search.trim();
    q = q.or(`invoice_number.ilike.%${s}%,counterpart_name.ilike.%${s}%,access_key.ilike.%${s}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as FiscalDocumentRow[];
}

export async function getFiscalSummary(
  storeId: string,
  year?: number | null,
  month?: number | null,
): Promise<FiscalSummary | null> {
  const { data, error } = await supabase.rpc('get_fiscal_summary', {
    p_store_id: storeId,
    p_year: year ?? null,
    p_month: month ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    pending_count: Number(row.pending_count) || 0,
    sent_count: Number(row.sent_count) || 0,
    declared_count: Number(row.declared_count) || 0,
    cancelled_count: Number(row.cancelled_count) || 0,
    period_count: Number(row.period_count) || 0,
    pending_amount: Number(row.pending_amount) || 0,
    overdue_count: Number(row.overdue_count) || 0,
    alert_days: Number(row.alert_days) || FISCAL_ALERT_DAYS_DEFAULT,
  };
}

export async function createFiscalDocument(storeId: string, input: FiscalDocumentInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_fiscal_document', {
    p_store_id: storeId,
    p_document_type: input.document_type,
    p_direction: input.direction,
    p_invoice_number: input.invoice_number,
    p_issue_date: input.issue_date,
    p_competence_month: input.competence_month,
    p_competence_year: input.competence_year,
    p_total_amount: input.total_amount,
    p_series: input.series ?? null,
    p_access_key: input.access_key ?? null,
    p_sale_id: input.sale_id ?? null,
    p_customer_id: input.customer_id ?? null,
    p_supplier_id: input.supplier_id ?? null,
    p_counterpart_name: input.counterpart_name ?? null,
    p_counterpart_doc: input.counterpart_doc ?? null,
    p_xml_path: input.xml_path ?? null,
    p_pdf_path: input.pdf_path ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateFiscalDocument(
  id: string,
  input: FiscalDocumentInput,
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('update_fiscal_document', {
    p_id: id,
    p_document_type: input.document_type,
    p_direction: input.direction,
    p_invoice_number: input.invoice_number,
    p_issue_date: input.issue_date,
    p_competence_month: input.competence_month,
    p_competence_year: input.competence_year,
    p_total_amount: input.total_amount,
    p_series: input.series ?? null,
    p_access_key: input.access_key ?? null,
    p_sale_id: input.sale_id ?? null,
    p_customer_id: input.customer_id ?? null,
    p_supplier_id: input.supplier_id ?? null,
    p_counterpart_name: input.counterpart_name ?? null,
    p_counterpart_doc: input.counterpart_doc ?? null,
    p_xml_path: input.xml_path ?? null,
    p_pdf_path: input.pdf_path ?? null,
    p_notes: input.notes ?? null,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function setFiscalDocumentStatus(
  id: string,
  status: FiscalStatus,
  notes?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_fiscal_document_status', {
    p_id: id,
    p_status: status,
    p_notes: notes ?? null,
  });
  if (error) throw error;
}

export async function uploadFiscalFile(storeId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const path = `${storeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(FISCAL_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

// Bucket privado: só URL assinada abre o arquivo (mesmo padrão de
// purchase-receipts em PurchasesReport.tsx).
export async function getFiscalFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FISCAL_BUCKET).createSignedUrl(path, 300);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export const FISCAL_STATUS_LABEL: Record<FiscalStatus, string> = {
  pending: 'Pendente de declaração',
  sent_to_accountant: 'Enviada ao contador',
  declared: 'Declarada',
  cancelled: 'Cancelada',
};

export const FISCAL_TYPE_LABEL: Record<FiscalDocumentType, string> = {
  nfe: 'NF-e',
  nfce: 'NFC-e',
  nfse: 'NFS-e',
  entrada: 'Nota de entrada',
  saida: 'Nota de saída',
  outro: 'Outro',
};

export const FISCAL_DIRECTION_LABEL: Record<FiscalDirection, string> = {
  incoming: 'Entrada',
  outgoing: 'Saída',
};

const FISCAL_ERRORS: Record<string, string> = {
  sem_permissao_fiscal: 'Seu perfil não tem permissão no módulo fiscal.',
  acesso_negado_store: 'Acesso negado para esta loja.',
  nota_duplicada: 'Já existe uma nota com esse número/série ou chave de acesso.',
  chave_acesso_invalida: 'A chave de acesso precisa ter 44 dígitos.',
  competencia_invalida: 'Competência inválida.',
  numero_nota_obrigatorio: 'Informe o número da nota.',
  valor_invalido: 'Valor da nota inválido.',
  venda_invalida: 'A venda selecionada não pertence a esta loja.',
  cliente_invalido: 'O cliente selecionado não pertence a esta loja.',
  fornecedor_invalido: 'O fornecedor selecionado não pertence a esta loja.',
  documento_nao_encontrado: 'Nota não encontrada.',
  documento_cancelado: 'Nota cancelada não pode ser editada.',
  status_invalido: 'Status inválido.',
  usuario_inativo: 'Usuário inativo.',
  perfil_nao_encontrado: 'Perfil não encontrado.',
};

export function resolveFiscalError(e: unknown): string {
  const msg = (e as { message?: string })?.message || '';
  for (const [code, friendly] of Object.entries(FISCAL_ERRORS)) {
    if (msg.includes(code)) return friendly;
  }
  return msg || 'Erro inesperado.';
}
