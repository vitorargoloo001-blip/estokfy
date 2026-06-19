import { supabase } from '@/integrations/supabase/client';

/**
 * Fonte ÚNICA da verdade para números financeiros do período.
 * Todas as telas (Dashboard, Vendas, Contas a Receber, Financeiro, Relatórios, PDF, CSV, IA)
 * devem consumir este payload — NUNCA recalcular por conta própria.
 *
 * Regras embutidas na RPC `get_financial_report_summary`:
 *  - Recebido = SOMA de `payments` com `paid_at` no período (única fonte).
 *  - Ignora pagamentos de vendas canceladas/excluídas/estornadas.
 *  - Venda a prazo entra em pendente; só vira recebido quando pagamento é registrado.
 *  - Itens vendidos vêm de `sale_items` apenas de vendas válidas.
 *  - Timezone America/Sao_Paulo.
 */
export interface FinancialSummary {
  period: { from: string; to: string };
  sales: {
    count_total: number;
    count_valid: number;
    count_cancelled: number;
    gross_total: number;
    net_total: number;
    discount_total: number;
    shipping_total: number;
    cost_total: number;
    gross_profit: number;
  };
  received: {
    total: number;
    count: number;
    by_method: Record<string, { amount: number; count: number }>;
    ignored_count: number;
    ignored_amount: number;
  };
  receivables: {
    open_total: number;
    open_count: number;
    overdue_total: number;
    overdue_count: number;
    settled_in_period: number;
  };
  items_sold: number;
  top_products: Array<{
    name: string;
    sku: string;
    category: string;
    qty: number;
    revenue: number;
  }>;
  expenses: {
    paid_total: number;
    count: number;
    by_category: Record<string, number>;
  };
  stock_purchases: { total: number; count: number };
  returns: { count: number; refund_total: number };
  net_cash: number;
  audit: {
    payments_used: Array<{
      id: string;
      sale_id: string | null;
      method: string;
      amount: number;
      paid_at: string;
      created_by: string | null;
    }>;
    payments_ignored: Array<{
      id: string;
      sale_id: string | null;
      method: string;
      amount: number;
      paid_at: string;
      s_status: string | null;
      s_deleted_at: string | null;
    }>;
    sales_ignored: Array<{
      id: string;
      status: string;
      deleted_at: string | null;
      net_total: number;
    }>;
    possible_duplicates: Array<{
      sale_id: string;
      method: string;
      day: string;
      amount: number;
      occurrences: number;
    }>;
  };
}

export interface FetchSummaryParams {
  storeId: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  employeeId?: string | null;
}

export async function fetchFinancialSummary(
  params: FetchSummaryParams
): Promise<FinancialSummary> {
  const { data, error } = await (supabase as any).rpc('get_financial_report_summary', {
    p_store_id: params.storeId,
    p_start: params.from,
    p_end: params.to,
    p_employee_id: params.employeeId ?? null,
  });
  if (error) throw error;
  return data as unknown as FinancialSummary;
}

/**
 * Detecta divergências entre o total recebido e a soma por método de pagamento.
 * Usado para exibir banner de alerta no relatório.
 */
export function detectDivergence(summary: FinancialSummary): string | null {
  if (summary.audit.possible_duplicates.length > 0) {
    return `Foram encontrados ${summary.audit.possible_duplicates.length} possíveis pagamentos duplicados. Verifique a auditoria.`;
  }
  const byMethodSum = Object.values(summary.received.by_method)
    .reduce((s, m) => s + Number(m.amount || 0), 0);
  if (Math.abs(byMethodSum - summary.received.total) > 0.01) {
    return 'Existe divergência entre pagamentos e relatório. Verifique a auditoria do período.';
  }
  return null;
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
