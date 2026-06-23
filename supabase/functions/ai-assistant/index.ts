/**
 * Estokfy AI Assistant Edge Function
 *
 * POST /ai-assistant
 * Body: { store_id, question, period_days? }
 * Auth: Bearer JWT
 *
 * Intent detection → RPC data fetch → Claude API → save interaction → return answer
 * ANTHROPIC_API_KEY must be set as a Supabase edge function secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// ----------------------------------------------------------------
// Intent detection — keyword matching in Portuguese
// ----------------------------------------------------------------
type Intent =
  | "financial_summary" | "cashflow" | "receivables_ranking" | "profit_analysis"
  | "sales_summary" | "top_products" | "sales_today" | "ticket_medio"
  | "employee_performance"
  | "low_stock" | "idle_products" | "purchase_suggestion" | "inventory_value"
  | "top_customers" | "churned_customers" | "delinquency_detail"
  | "connect_summary"
  | "health_score"
  | "unknown";

function detectIntent(q: string): Intent {
  const s = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Connect
  if (/concili|divergenc|extrato|banco|bank|reconcili/.test(s)) return "connect_summary";

  // Health
  if (/saude|health score|pontuacao|score da empresa/.test(s)) return "health_score";

  // Financial
  if (/lucro|margem|resultado|dre/.test(s)) return "profit_analysis";
  if (/fluxo.*caixa|saldo.*caixa|caixa previsto|previsao/.test(s)) return "cashflow";
  if (/deve|devendo|a receber|inadimpl|cobranc|quem.*mais.*deve/.test(s)) return "receivables_ranking";
  if (/entrou|caixa|faturamento|receita|dinheiro|pagamento|quanto.*mes|quanto.*hoje.*caixa/.test(s)) return "financial_summary";

  // Sales
  if (/ticket.*medio|ticket/.test(s)) return "ticket_medio";
  if (/vendi hoje|vendas.*hoje|hoje.*vend/.test(s)) return "sales_today";
  if (/produto.*mais.*vend|mais vendido|top produto|vendeu mais/.test(s)) return "top_products";
  if (/vendedor|funcionario.*vend|quem vendeu|melhor.*vendedor|desempenho.*equipe/.test(s)) return "employee_performance";
  if (/quanto.*vend|total.*vend|vendas.*mes|vendas.*semana|vendi/.test(s)) return "sales_summary";

  // Inventory
  if (/comprar|repor|reposic|precisar comprar/.test(s)) return "purchase_suggestion";
  if (/parado|sem giro|encalhado/.test(s)) return "idle_products";
  if (/acabando|estoque baixo|estoque critico|ruptura|faltando/.test(s)) return "low_stock";
  if (/valor.*estoque|estoque.*parado.*valor|capital.*imobilizado/.test(s)) return "inventory_value";
  if (/estoque/.test(s)) return "low_stock";

  // Customers
  if (/parou de comprar|sumiu|cliente.*perdid|sem comprar/.test(s)) return "churned_customers";
  if (/inadimplente|devendo|em atraso/.test(s)) return "delinquency_detail";
  if (/cliente.*compra|melhor cliente|top cliente|quem mais compra/.test(s)) return "top_customers";

  return "unknown";
}

function intentDataSources(intent: Intent): string[] {
  const map: Record<Intent, string[]> = {
    financial_summary:    ["ai_get_financial_summary"],
    cashflow:             ["ai_get_financial_summary"],
    receivables_ranking:  ["ai_get_financial_summary", "ai_get_customer_summary"],
    profit_analysis:      ["ai_get_financial_summary"],
    sales_summary:        ["ai_get_sales_summary"],
    sales_today:          ["ai_get_sales_summary"],
    top_products:         ["ai_get_sales_summary"],
    ticket_medio:         ["ai_get_sales_summary"],
    employee_performance: ["ai_get_employee_summary"],
    low_stock:            ["ai_get_inventory_summary"],
    idle_products:        ["ai_get_inventory_summary"],
    purchase_suggestion:  ["ai_get_inventory_summary"],
    inventory_value:      ["ai_get_inventory_summary"],
    top_customers:        ["ai_get_customer_summary"],
    churned_customers:    ["ai_get_customer_summary"],
    delinquency_detail:   ["ai_get_customer_summary", "ai_get_financial_summary"],
    connect_summary:      ["ai_get_connect_summary"],
    health_score:         ["ai_get_business_health_score"],
    unknown:              [],
  };
  return map[intent] ?? [];
}

// ----------------------------------------------------------------
// Fetch context data from RPCs
// ----------------------------------------------------------------
async function fetchContext(
  supabase: ReturnType<typeof createClient>,
  intent: Intent,
  storeId: string,
  periodDays: number
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {};
  const sources = intentDataSources(intent);

  await Promise.all(sources.map(async (rpcName) => {
    const params: Record<string, unknown> = { p_store_id: storeId };
    if (["ai_get_financial_summary","ai_get_sales_summary","ai_get_customer_summary","ai_get_employee_summary","ai_get_connect_summary"].includes(rpcName)) {
      params.p_period_days = periodDays;
    }
    const { data, error } = await supabase.rpc(rpcName, params);
    if (!error && data) ctx[rpcName] = data;
  }));

  return ctx;
}

// ----------------------------------------------------------------
// Format data as human-readable context string
// ----------------------------------------------------------------
function buildContextStr(intent: Intent, ctx: Record<string, unknown>): string {
  const lines: string[] = [];

  const fin = ctx["ai_get_financial_summary"] as Record<string,unknown> | undefined;
  const sal = ctx["ai_get_sales_summary"] as Record<string,unknown> | undefined;
  const inv = ctx["ai_get_inventory_summary"] as Record<string,unknown> | undefined;
  const cus = ctx["ai_get_customer_summary"] as Record<string,unknown> | undefined;
  const emp = ctx["ai_get_employee_summary"] as Record<string,unknown> | undefined;
  const con = ctx["ai_get_connect_summary"] as Record<string,unknown> | undefined;
  const hlt = ctx["ai_get_business_health_score"] as Record<string,unknown> | undefined;

  const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  if (fin) {
    lines.push(`=== FINANCEIRO (${fin.periodo}) ===`);
    lines.push(`Receita total: ${brl(Number(fin.receita_total))}`);
    lines.push(`Receita hoje: ${brl(Number(fin.receita_hoje))}`);
    lines.push(`Receita semana: ${brl(Number(fin.receita_semana))}`);
    lines.push(`A receber: ${brl(Number(fin.a_receber))}`);
    lines.push(`A pagar: ${brl(Number(fin.a_pagar))}`);
    lines.push(`Saldo caixa: ${brl(Number(fin.saldo_caixa))}`);
    lines.push(`Inadimplência (vencida): ${brl(Number(fin.inadimplencia))}`);
    if (fin.maior_devedor !== "Nenhum") {
      lines.push(`Maior devedor: ${fin.maior_devedor} (${brl(Number(fin.maior_devedor_valor))})`);
    }
  }

  if (sal) {
    lines.push(`=== VENDAS (${sal.periodo}) ===`);
    lines.push(`Total de vendas: ${sal.total_vendas} pedidos — ${brl(Number(sal.valor_total))}`);
    lines.push(`Ticket médio: ${brl(Number(sal.ticket_medio))}`);
    lines.push(`Vendas hoje: ${sal.vendas_hoje}`);
    lines.push(`Produto mais vendido: ${sal.top_produto}`);
    lines.push(`Categoria líder: ${sal.top_categoria}`);
    lines.push(`Melhor vendedor: ${sal.top_vendedor}`);
    lines.push(`Método mais usado: ${sal.metodo_mais_usado}`);
  }

  if (inv) {
    lines.push(`=== ESTOQUE ===`);
    lines.push(`Total de produtos: ${inv.total_produtos}`);
    lines.push(`Valor do estoque: ${brl(Number(inv.valor_total_estoque))}`);
    lines.push(`Sem estoque: ${inv.sem_estoque}`);
    lines.push(`Estoque crítico (≤5 un): ${inv.estoque_baixo}`);
    lines.push(`Produtos parados (30d): ${inv.parados_30d} — ${brl(Number(inv.valor_parado))} imobilizados`);
    if (Array.isArray(inv.top_ruptura) && inv.top_ruptura.length > 0) {
      lines.push(`Próximos a zerar: ${(inv.top_ruptura as any[]).map((p:any) => `${p.name} (${p.qty} un)`).join(", ")}`);
    }
  }

  if (cus) {
    lines.push(`=== CLIENTES (${cus.periodo}) ===`);
    lines.push(`Total: ${cus.total_clientes}`);
    lines.push(`Inadimplentes: ${cus.inadimplentes} — ${brl(Number(cus.valor_inadimplente))}`);
    lines.push(`Sem comprar há 60d: ${cus.sem_comprar_60d}`);
    lines.push(`Ticket médio por cliente: ${brl(Number(cus.ticket_medio_cliente))}`);
    if (Array.isArray(cus.top_clientes) && cus.top_clientes.length > 0) {
      lines.push(`Top clientes: ${(cus.top_clientes as any[]).map((c:any) => `${c.name} (${brl(c.total)})`).join(", ")}`);
    }
  }

  if (emp) {
    lines.push(`=== EQUIPE (${emp.periodo}) ===`);
    lines.push(`Equipe: ${emp.total_equipe} pessoas`);
    if (emp.melhor_vendedor !== "—") {
      lines.push(`Melhor desempenho: ${emp.melhor_vendedor} (${brl(Number(emp.melhor_total))})`);
    }
    if (Array.isArray(emp.ranking) && emp.ranking.length > 0) {
      lines.push(`Ranking: ${(emp.ranking as any[]).map((r:any,i:number) => `${i+1}. ${r.name} — ${brl(r.total)} (${r.pedidos} pedidos)`).join("; ")}`);
    }
  }

  if (con) {
    lines.push(`=== CONCILIAÇÃO (${con.periodo}) ===`);
    if (con.connect_ativo) {
      lines.push(`Transações: ${con.total_transacoes} | Conciliadas: ${con.conciliadas} | Divergentes: ${con.divergentes} | Pendentes: ${con.pendentes}`);
      lines.push(`Taxa de conciliação: ${con.taxa_conciliacao}%`);
      lines.push(`Valor divergente: ${brl(Number(con.valor_divergente))}`);
      lines.push(`Banco com maior volume: ${con.banco_maior_volume}`);
    } else {
      lines.push(`Módulo Connect não ativo nesta loja.`);
    }
  }

  if (hlt) {
    lines.push(`=== SAÚDE DA EMPRESA ===`);
    lines.push(`Score: ${hlt.score}/100 — ${hlt.grade}`);
    const bd = hlt.breakdown as Record<string,number>;
    lines.push(`Breakdown: Vendas ${bd.vendas}/20, Recebimentos ${bd.recebimentos}/15, Inadimplência ${bd.inadimplencia}/15, Ruptura ${bd.ruptura}/10, Parados ${bd.parados}/10, Margem ${bd.margem}/15, Connect ${bd.connect}/10`);
    if (Array.isArray(hlt.strengths) && hlt.strengths.length > 0) lines.push(`Pontos fortes: ${(hlt.strengths as string[]).join(", ")}`);
    if (Array.isArray(hlt.weaknesses) && hlt.weaknesses.length > 0) lines.push(`Pontos de atenção: ${(hlt.weaknesses as string[]).join(", ")}`);
    lines.push(`Recomendação: ${hlt.recommendation}`);
  }

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Call Claude API
// ----------------------------------------------------------------
async function callClaude(systemPrompt: string, question: string): Promise<string> {
  if (!ANTHROPIC_KEY) {
    // Fallback: structured response without Claude
    return `(Modo offline — configure ANTHROPIC_API_KEY para respostas em linguagem natural)\n\nDados encontrados:\n${systemPrompt}`;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: `Você é o assistente executivo do Estokfy, um sistema de gestão para pequenas e médias empresas brasileiras.

Responda SEMPRE em português brasileiro. Seja direto, objetivo e use dados concretos da loja.

Formato de resposta obrigatório:
1. Resposta direta com os números principais
2. Observação relevante sobre o contexto
3. Uma recomendação prática no final

Regras:
- Use apenas dados fornecidos no contexto abaixo
- Nunca invente números que não estão no contexto
- Se os dados não respondem a pergunta, diga claramente
- Use formatação BRL correta (R$ 1.000,00)
- Seja conciso — máximo 4 parágrafos

DADOS DA LOJA:
${systemPrompt}`,
      messages: [{ role: "user", content: question }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json() as { content: { type: string; text: string }[] };
  return json.content.find(c => c.type === "text")?.text ?? "Não foi possível gerar uma resposta.";
}

// ----------------------------------------------------------------
// Handler
// ----------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });

  try {
    const { store_id, question, period_days = 30 } = await req.json() as { store_id: string; question: string; period_days?: number };
    if (!store_id || !question?.trim()) {
      return new Response(JSON.stringify({ error: "store_id e question são obrigatórios" }), { status: 400, headers: CORS });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    // Detect intent
    const intent = detectIntent(question);

    // Handle unknown
    if (intent === "unknown") {
      const fallbackAnswer = "Não consegui identificar essa análise. Tente perguntar sobre vendas, estoque, financeiro, clientes ou conciliação bancária.";
      await supabase.rpc("save_ai_interaction", {
        p_store_id: store_id, p_question: question, p_intent: intent, p_answer: fallbackAnswer, p_data_sources: [],
      });
      return new Response(JSON.stringify({ answer: fallbackAnswer, intent, data: {} }), { headers: CORS });
    }

    // Fetch context data
    const ctx = await fetchContext(supabase, intent, store_id, period_days);
    const contextStr = buildContextStr(intent, ctx);

    // Generate answer
    const answer = await callClaude(contextStr, question);

    // Save interaction (fire-and-forget)
    supabase.rpc("save_ai_interaction", {
      p_store_id: store_id,
      p_question: question,
      p_intent: intent,
      p_answer: answer,
      p_data_sources: intentDataSources(intent),
    }).then(() => {}).catch(() => {});

    return new Response(
      JSON.stringify({ answer, intent, data: ctx }),
      { headers: CORS }
    );
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: CORS }
    );
  }
});
