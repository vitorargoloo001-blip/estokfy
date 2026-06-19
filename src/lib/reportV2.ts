import { supabase } from '@/integrations/supabase/client';

/**
 * Fonte ÚNICA da verdade — relatório operacional v2.
 *
 * Regras-chave:
 *  - "Vendido" usa `sales.sale_date` (data comercial da operação). Suporta vendas retroativas.
 *  - "Recebido" usa `payments.paid_at`.
 *  - `created_at` / `registered_at` servem apenas para auditoria.
 *  - Pagamentos de vendas canceladas/deletadas são ignorados.
 *  - Pagamentos com method='pending' não entram em "recebido" (são pendência).
 *
 * Consumido por: Dashboard, Vendas, Contas a Receber, Financeiro, Relatórios, PDF, CSV, IA, Cliente 360.
 * NUNCA recalcular esses números no frontend.
 */

export interface OperationalReport {
  period: { from: string; to: string };
  filters: { employee_id: string | null; payment_method: string | null; customer_id: string | null };
  vendido: {
    count_total: number;
    count_valid: number;
    count_cancelled: number;
    gross_total: number;
    net_total: number;
    discount_total: number;
    shipping_total: number;
    cost_total: number;
    gross_profit: number;
    items_count: number;
    por_dia: Array<{ day: string; count: number; total: number }>;
    por_forma_no_ato: Record<string, number>;
  };
  recebido: {
    total: number;
    count: number;
    by_method: Record<string, { amount: number; count: number }>;
    por_dia: Array<{ day: string; total: number }>;
    ignored_count: number;
    ignored_amount: number;
  };
  pendente: {
    open_total: number;
    open_count: number;
    overdue_total: number;
    overdue_count: number;
    a_vencer_total: number;
    settled_in_period: number;
  };
  produtos_top: Array<{ name: string; sku: string; category: string; qty: number; revenue: number }>;
  funcionarios: Array<{
    profile_id: string | null;
    name: string;
    sales_count: number;
    sold: number;
    paid: number;
    pending: number;
    ticket_avg: number;
  }>;
  devolucoes: { count: number; refund_total: number };
  despesas: { paid_total: number; count: number; by_category: Record<string, number> };
  stock_purchases: { total: number; count: number };
  caixa: { entradas: number; saidas: number; saldo: number };
  alertas: {
    vendas_retroativas: number;
    duplicidades_pagamentos: number;
    vendas_sem_pagamento: number;
  };
  auditoria: {
    vendas_usadas: Array<{
      id: string;
      sale_date: string;
      registered_at: string;
      created_at: string;
      status: string;
      payment_status: string;
      net_total: number;
      amount_paid: number;
      amount_pending: number;
      customer_id: string | null;
      created_by: string | null;
      retroactive: boolean;
    }>;
    pagamentos_usados: Array<{
      id: string;
      sale_id: string | null;
      method: string;
      amount: number;
      paid_at: string;
      s_sale_date: string | null;
      created_by: string | null;
    }>;
    pagamentos_ignorados: Array<any>;
    vendas_ignoradas: Array<any>;
    retroativas: Array<{ id: string; sale_date: string; registered_at: string; net_total: number }>;
    duplicidades: Array<{ sale_id: string; method: string; day: string; amount: number; occurrences: number }>;
  };
}

export interface FetchReportParams {
  storeId: string;
  from: string;
  to: string;
  employeeId?: string | null;
  paymentMethod?: string | null;
  customerId?: string | null;
}

export async function fetchOperationalReport(params: FetchReportParams): Promise<OperationalReport> {
  const { data, error } = await (supabase as any).rpc('obter_relatorio_operacional_v2', {
    p_store_id: params.storeId,
    p_start: params.from,
    p_end: params.to,
    p_employee_id: params.employeeId ?? null,
    p_payment_method: params.paymentMethod ?? null,
    p_customer_id: params.customerId ?? null,
  });
  if (error) throw error;
  return data as unknown as OperationalReport;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  cash: 'Dinheiro',
  card: 'Cartão',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  transfer: 'Transferência',
  boleto: 'Boleto',
  pending: 'A prazo',
  a_prazo: 'A prazo',
  outro: 'Outro',
  other: 'Outro',
};

export function labelMethod(m: string): string {
  return PAYMENT_METHOD_LABELS[m] || m;
}

export function detectReportDivergence(r: OperationalReport): string | null {
  if (r.auditoria.duplicidades.length > 0) {
    return `${r.auditoria.duplicidades.length} possíveis pagamentos duplicados. Verifique a auditoria.`;
  }
  const byMethodSum = Object.values(r.recebido.by_method).reduce((s, m) => s + Number(m.amount || 0), 0);
  if (Math.abs(byMethodSum - r.recebido.total) > 0.01) {
    return 'Divergência entre pagamentos e relatório.';
  }
  return null;
}
