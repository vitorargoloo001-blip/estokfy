// AI narrative analysis of a report period using Lovable AI Gateway
// Returns structured JSON via tool-calling: { summary, alerts[], suggestions[] }
// Persists analysis in report_ai_analyses for the authenticated user's store
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!LOVABLE_API_KEY) return json({ error: "missing_key", message: "LOVABLE_API_KEY não configurada." }, 500);

    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "missing_token" }, 401);

    const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "missing_token" }, 401);

    const svc = createClient(SB_URL, SB_SERVICE);
    const { data: profile } = await svc
      .from("profiles")
      .select("id, store_id, is_active")
      .eq("auth_user_id", user.id)
      .single();
    if (!profile?.is_active) return json({ error: "sem_permissao" }, 403);

    const body = await req.json().catch(() => ({}));
    const { summary, sales, returns, stock, finance, period } = body || {};
    if (!summary || !period) return json({ error: "payload_invalido" }, 400);

    const fmt = (v: number) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const topProd = (sales?.top_products || []).slice(0, 3).map((p: any) => `${p.name} (${p.qty}un, ${fmt(p.revenue)})`).join(", ") || "—";
    const topMethods = Object.entries(sales?.payment_methods || {})
      .map(([m, v]: any) => `${m}: ${fmt(v.amount)}`).join(", ") || "—";
    const topExpenses = Object.entries(finance?.expense_by_category || {})
      .sort((a: any, b: any) => b[1] - a[1]).slice(0, 3)
      .map(([c, v]: any) => `${c}: ${fmt(v)}`).join(", ") || "—";

    const userPrompt = `Analise os dados de operação de uma loja entre ${period.from} e ${period.to}.

DADOS:
- Faturamento bruto: ${fmt(summary.gross_revenue)}
- Faturamento líquido: ${fmt(summary.net_revenue)}
- Lucro bruto: ${fmt(summary.gross_profit)}
- Despesas totais: ${fmt(summary.expense_total)}
- Compras de estoque: ${fmt(summary.purchase_total)}
- Total de vendas: ${summary.sales_count}
- Ticket médio: ${fmt(sales?.ticket_avg || 0)}
- Devoluções: ${summary.returns_count} (impacto ${fmt(summary.refund_total)})
- Saldo do período: ${fmt(summary.balance)}
- Vendas a receber (pendente): ${fmt(summary.amount_pending || 0)} em ${summary.pending_sales_count || 0} venda(s)
- Vendas vencidas: ${summary.overdue_sales_count || 0} (${fmt(summary.overdue_amount || 0)})
- Top produtos vendidos: ${topProd}
- Formas de pagamento: ${topMethods}
- Top despesas: ${topExpenses}
- Produtos com estoque crítico: ${(stock?.low_stock || []).length}

Chame a função "report_analysis" com:
- summary: 2-4 frases curtas em pt-BR descrevendo o desempenho geral (faturamento, lucro, vendas)
- alerts: lista de 0-5 pontos de atenção concretos (ex.: "X produtos sem estoque", "Despesa Y maior que Z")
- suggestions: lista de 0-5 ações práticas e específicas (ex.: "Reabasteça produto X", "Cobre clientes com vencimento atrasado")

Seja direto, evite generalidades. Se algo estiver bom, mencione no summary. Use valores e nomes reais dos dados.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "report_analysis",
          description: "Retorna análise estruturada do período com resumo, alertas e sugestões.",
          parameters: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description: "Resumo executivo curto (2 a 4 frases) do desempenho do período.",
              },
              alerts: {
                type: "array",
                description: "Pontos de atenção/alertas (0 a 5 itens).",
                items: { type: "string" },
              },
              suggestions: {
                type: "array",
                description: "Sugestões práticas e acionáveis (0 a 5 itens).",
                items: { type: "string" },
              },
            },
            required: ["summary", "alerts", "suggestions"],
            additionalProperties: false,
          },
        },
      },
    ];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um analista financeiro de varejo. Responda em pt-BR de forma clara, objetiva e baseada nos dados fornecidos." },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "report_analysis" } },
      }),
    });

    if (resp.status === 429) return json({ error: "rate_limit", message: "Muitas requisições à IA. Aguarde um momento." }, 429);
    if (resp.status === 402) return json({ error: "no_credits", message: "Créditos de IA esgotados. Adicione créditos no workspace." }, 402);
    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      return json({ error: "ai_error", message: "Erro ao gerar análise." }, 500);
    }

    const data = await resp.json();
    const message = data?.choices?.[0]?.message;
    let parsed: { summary: string; alerts: string[]; suggestions: string[] } = {
      summary: "", alerts: [], suggestions: [],
    };

    const toolCall = message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        parsed = {
          summary: String(args.summary || ""),
          alerts: Array.isArray(args.alerts) ? args.alerts.map((s: any) => String(s)).filter(Boolean) : [],
          suggestions: Array.isArray(args.suggestions) ? args.suggestions.map((s: any) => String(s)).filter(Boolean) : [],
        };
      } catch (e) {
        console.error("Failed to parse tool call args:", e);
      }
    }

    // Fallback: if model returned plain content instead of tool call
    if (!parsed.summary && message?.content) {
      parsed.summary = String(message.content).slice(0, 800);
    }

    // Build display text for backward-compat (also used in PDF)
    const textParts: string[] = [];
    if (parsed.summary) textParts.push(parsed.summary);
    if (parsed.alerts.length) textParts.push("\nPontos de atenção:\n" + parsed.alerts.map((a) => `• ${a}`).join("\n"));
    if (parsed.suggestions.length) textParts.push("\nSugestões:\n" + parsed.suggestions.map((s) => `→ ${s}`).join("\n"));
    const text = textParts.join("\n") || "Sem análise disponível.";

    // Persist analysis (text + structured in metadata)
    const { data: saved, error: saveErr } = await svc
      .from("report_ai_analyses")
      .insert({
        store_id: profile.store_id,
        created_by: profile.id,
        report_type: "detailed",
        period_start: period.from,
        period_end: period.to,
        analysis_text: text,
        metadata: {
          gross_revenue: summary.gross_revenue,
          net_revenue: summary.net_revenue,
          sales_count: summary.sales_count,
          structured: parsed,
        },
      })
      .select("id, created_at")
      .single();

    if (saveErr) console.error("Failed to persist analysis:", saveErr);

    return json({
      analysis: text,
      structured: parsed,
      id: saved?.id || null,
      created_at: saved?.created_at || new Date().toISOString(),
    });
  } catch (e) {
    console.error("reports-ai-analysis error:", e);
    return json({ error: "internal_error", message: "Erro interno." }, 500);
  }
});
