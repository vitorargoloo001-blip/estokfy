import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function json(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function redactSensitive(text: string): string {
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "***CPF***")
    .replace(/\b[A-Za-z0-9]{32,}\b/g, "***TOKEN***")
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "***CARD***");
}

const SYSTEM_PROMPT = `Você é o assistente de suporte IA do Estokfy (gestão de loja de peças). Seu nome é "Suporte IA".

REGRAS CRÍTICAS:
- Nunca peça senhas, chaves de API ou dados bancários completos
- Mascare CPF, CNPJ e IDs de transação nas respostas
- Antes de executar qualquer ação que modifique dados (venda, ajuste de estoque, devolução), SEMPRE peça confirmação explícita do usuário
- Para ações de NAVEGAÇÃO (abrir tela), execute direto sem pedir confirmação
- Se não tiver certeza, sugira escalar para humano
- Responda em português brasileiro, máximo 3 frases (a menos que peçam detalhes)
- Use os DADOS DA LOJA fornecidos abaixo para responder perguntas reais sobre vendas, estoque e contas

AÇÕES QUE MODIFICAM DADOS (precisam de confirmação, needs_confirm: true):
- sales-create | stock-adjust | returns-create

AÇÕES DE NAVEGAÇÃO (executam direto, sem needs_confirm):
- navigate: abre uma rota. Use action_payload: { route: "/caminho" }. Rotas válidas:
  /vendas/nova | /produtos | /produtos-parados | /estoque | /vendas | /trocas | /financeiro
  /contas-a-receber | /contas-a-pagar | /clientes | /entregas | /relatorios | /relatorios/compras

CONSULTAS REAIS (use action: "query" para buscar dados específicos antes de responder).
SEMPRE use uma query quando o usuário pedir alertas, histórico de produto, dados de cliente, ou recomendações. Cada query retorna automaticamente um link de navegação para a tela correspondente.

- target: "notifications" — alertas ativos. payload: { target: "notifications", limit?: 10 } → link /notificacoes (ou /dashboard)
- target: "product_history" — histórico do produto. Use product_id (uuid) OU product_name (string para busca). payload: { target: "product_history", product_id?: "uuid", product_name?: "tela iphone" } → link /produtos
- target: "customer_360" — visão 360. Use customer_id OU customer_name. payload: { target: "customer_360", customer_id?: "uuid", customer_name?: "joão" } → link /clientes
- target: "dashboard_intelligence" — top recomendações. payload: { target: "dashboard_intelligence", limit?: 5 } → link /dashboard

Sempre que o usuário mencionar um nome de produto/cliente sem ID, use product_name/customer_name — a função resolve sozinha.

AÇÕES DE LEITURA:
- reports-summary: gerar relatório (aceita from, to)

Formato de resposta (sempre JSON puro):
- Sem ação: {"reply": "..."}
- Navegação: {"reply": "Abrindo X...", "action": "navigate", "action_payload": {"route": "/..."}}
- Consulta de dados: {"reply": "Vou consultar...", "action": "query", "action_payload": {"target": "notifications"}}
- Ação destrutiva: {"reply": "...", "action": "...", "action_payload": {...}, "needs_confirm": true}
- Escalar: {"reply": "...", "handoff": true, "handoff_reason": "..."}

CONTEXTO DO USUÁRIO:
- Rota atual: {{route}}
- Role: {{role}}
- Loja: {{store_id}}

DADOS DA LOJA (snapshot agora):
{{live_data}}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing_token" }, 401);

    const userClient = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const { data: profile } = await userClient.rpc("current_profile");
    if (!profile?.[0]) return json({ error: "profile_not_found" }, 403);
    const ctx = profile[0];

    const body = await req.json();
    const { message, route, conversation_id, confirm_action, stream } = body;

    if (!message?.trim() && !confirm_action) {
      return json({ error: "message_required" }, 400);
    }

    const svc = createClient(SB_URL, SB_SERVICE);

    // Handle action confirmation (never streamed)
    if (confirm_action && conversation_id) {
      return await handleConfirmation(svc, userClient, authHeader, ctx, conversation_id, confirm_action);
    }

    // Get or create conversation
    let convId = conversation_id;
    if (!convId) {
      const { data: conv, error: convErr } = await userClient
        .from("ai_conversations")
        .insert({ store_id: ctx.store_id, profile_id: ctx.profile_id, route, status: "active" })
        .select("id")
        .single();
      if (convErr) throw convErr;
      convId = conv.id;
    }

    // Save user message
    const redacted = redactSensitive(message);
    await svc.from("ai_messages").insert({
      conversation_id: convId,
      role: "user",
      content: message,
      redacted_content: redacted !== message ? redacted : null,
    });

    // Load last 10 messages
    const { data: history } = await svc
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(10);

    // Load training data
    const { data: training } = await svc
      .from("ai_training_data")
      .select("intent, category, question_example, answer_template, action_type")
      .or(`is_global.eq.true,store_id.eq.${ctx.store_id}`)
      .limit(30);

    const trainingContext = training?.map(t =>
      `Intent: ${t.intent} | Cat: ${t.category} | Ex: "${t.question_example}" | Resp: "${t.answer_template}" | Ação: ${t.action_type || "nenhuma"}`
    ).join("\n") || "";

    // Snapshot de dados reais da loja para a IA responder com números
    const liveData = await loadLiveStoreData(svc, ctx.store_id);

    const systemPrompt = SYSTEM_PROMPT
      .replace("{{route}}", route || "/")
      .replace("{{role}}", ctx.role)
      .replace("{{store_id}}", ctx.store_id)
      .replace("{{live_data}}", liveData)
      + `\n\nBASE DE CONHECIMENTO:\n${trainingContext}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(history || []).map((m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
    ];

    // Call Lovable AI
    const aiResp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
        temperature: 0.2,
        max_tokens: 600,
        stream: !!stream,
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429) return json({ error: "rate_limited", reply: "Muitas requisições. Tente novamente em alguns segundos." }, 429);
      if (status === 402) return json({ error: "credits_exhausted", reply: "Créditos de IA esgotados. Contate o administrador." }, 402);
      console.error("AI error:", status, await aiResp.text());
      return json({ error: "ai_error", reply: "Erro ao consultar o assistente. Tente novamente." }, 500);
    }

    // STREAMING PATH
    if (stream && aiResp.body) {
      const reader = aiResp.body.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      let fullContent = "";

      const readable = new ReadableStream({
        async start(controller) {
          // Send conversation_id as first event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversation_id: convId })}\n\n`));

          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              let nlIdx: number;
              while ((nlIdx = buffer.indexOf("\n")) !== -1) {
                let line = buffer.slice(0, nlIdx);
                buffer = buffer.slice(nlIdx + 1);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") {
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  continue;
                }
                try {
                  const parsed = JSON.parse(payload);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) {
                    fullContent += delta;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
                  }
                } catch {
                  // partial JSON, skip
                }
              }
            }
          } catch (e) {
            console.error("Stream read error:", e);
          }

          // Save assistant message after stream completes
          try {
            const redactedReply = redactSensitive(fullContent);
            await svc.from("ai_messages").insert({
              conversation_id: convId,
              role: "assistant",
              content: fullContent,
              redacted_content: redactedReply !== fullContent ? redactedReply : null,
            });

            // Check for action in the full content
            const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.action && parsed.needs_confirm) {
                  const { data: evt } = await svc
                    .from("ai_events")
                    .insert({
                      conversation_id: convId,
                      store_id: ctx.store_id,
                      action_type: parsed.action,
                      action_payload: parsed.action_payload || null,
                      confirmed: false,
                    })
                    .select("id")
                    .single();

                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    action: parsed.action,
                    event_id: evt?.id,
                    needs_confirm: true,
                    action_payload: parsed.action_payload,
                  })}\n\n`));
                }
                if (parsed.handoff) {
                  await svc.from("ai_handoffs").insert({
                    conversation_id: convId,
                    store_id: ctx.store_id,
                    reason: parsed.handoff_reason || "Solicitado pelo assistente",
                    status: "pending",
                  });
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ handoff: true })}\n\n`));
                }
                // Auto-execute query tools and stream the result + nav_link
                if (parsed.action === "query" && parsed.action_payload) {
                  const qResult = await runQueryTool(userClient, parsed.action_payload as Record<string, unknown>);
                  const summary = summarizeQueryResult(parsed.action_payload.target as string, qResult);
                  await svc.from("ai_messages").insert({
                    conversation_id: convId,
                    role: "assistant",
                    content: summary.text,
                  });
                  await svc.from("ai_events").insert({
                    conversation_id: convId,
                    store_id: ctx.store_id,
                    action_type: "query",
                    action_payload: parsed.action_payload,
                    confirmed: true,
                    result: { data: qResult, nav_link: summary.link },
                  });
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    query_summary: summary.text,
                    nav_link: summary.link,
                  })}\n\n`));
                }
              } catch { /* not valid action JSON */ }
            }
          } catch (e) {
            console.error("Post-stream save error:", e);
          }

          controller.close();
        },
      });

      return new Response(readable, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    // NON-STREAMING PATH
    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    let reply = rawContent;
    let action: string | null = null;
    let actionPayload: Record<string, unknown> | null = null;
    let needsConfirm = false;
    let handoff = false;
    let handoffReason = "";

    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        reply = parsed.reply || rawContent;
        action = parsed.action || null;
        actionPayload = parsed.action_payload || null;
        needsConfirm = parsed.needs_confirm || false;
        handoff = parsed.handoff || false;
        handoffReason = parsed.handoff_reason || "";
      }
    } catch { /* not JSON */ }

    const redactedReply = redactSensitive(reply);
    await svc.from("ai_messages").insert({
      conversation_id: convId,
      role: "assistant",
      content: reply,
      redacted_content: redactedReply !== reply ? redactedReply : null,
    });

    let eventId: string | null = null;
    if (action && needsConfirm) {
      const { data: evt } = await svc
        .from("ai_events")
        .insert({
          conversation_id: convId,
          store_id: ctx.store_id,
          action_type: action,
          action_payload: actionPayload,
          confirmed: false,
        })
        .select("id")
        .single();
      eventId = evt?.id || null;
    }

    if (handoff) {
      await svc.from("ai_handoffs").insert({
        conversation_id: convId,
        store_id: ctx.store_id,
        reason: handoffReason || "Solicitado pelo assistente",
        status: "pending",
      });
    }

    // Execute "query" actions inline (RLS-safe via userClient) and append result to reply
    let queryResult: unknown = undefined;
    let navLink: { route: string; label: string } | undefined = undefined;
    if (action === "query" && actionPayload) {
      queryResult = await runQueryTool(userClient, actionPayload as Record<string, unknown>);
      const summary = summarizeQueryResult(actionPayload.target as string, queryResult);
      reply = `${reply}\n\n${summary.text}`.trim();
      navLink = summary.link;
      await svc.from("ai_messages").insert({
        conversation_id: convId,
        role: "assistant",
        content: summary.text,
      });
      await svc.from("ai_events").insert({
        conversation_id: convId,
        store_id: ctx.store_id,
        action_type: "query",
        action_payload: actionPayload,
        confirmed: true,
        result: { data: queryResult, nav_link: navLink },
      });
      // Don't surface "query" as a pending action to the client
      action = null;
      actionPayload = null;
    }

    return json({
      conversation_id: convId,
      reply,
      action: action || undefined,
      action_payload: actionPayload || undefined,
      needs_confirm: needsConfirm || undefined,
      event_id: eventId || undefined,
      handoff: handoff || undefined,
      query_result: queryResult,
      nav_link: navLink,
    }, 200);
  } catch (e) {
    console.error("ai-support-chat error:", e);
    return json({ error: "internal_error", reply: "Erro interno. Tente novamente." }, 500);
  }
});

async function handleConfirmation(
  svc: ReturnType<typeof createClient>,
  userClient: ReturnType<typeof createClient>,
  authHeader: string,
  ctx: { store_id: string; profile_id: string; role: string },
  conversationId: string,
  confirmAction: { event_id: string; confirmed: boolean },
) {
  const { event_id, confirmed } = confirmAction;

  const { data: evt, error: evtErr } = await svc
    .from("ai_events")
    .select("*")
    .eq("id", event_id)
    .eq("store_id", ctx.store_id)
    .single();

  if (evtErr || !evt) return json({ error: "event_not_found" }, 404);
  if (evt.confirmed) return json({ error: "already_processed", reply: "Esta ação já foi processada." }, 409);

  if (!confirmed) {
    await svc.from("ai_events").update({ confirmed: false, result: { cancelled: true } }).eq("id", event_id);
    const reply = "Ação cancelada. Como posso ajudar?";
    await svc.from("ai_messages").insert({ conversation_id: conversationId, role: "assistant", content: reply });
    return json({ conversation_id: conversationId, reply }, 200);
  }

  const actionType = evt.action_type;
  const payload = evt.action_payload || {};
  const idemKey = crypto.randomUUID();

  let functionName: string;
  let functionBody: Record<string, unknown>;

  switch (actionType) {
    case "sales-create":
      functionName = "sales-create";
      functionBody = { store_id: ctx.store_id, ...payload };
      break;
    case "stock-adjust":
      functionName = "stock-adjust";
      functionBody = { store_id: ctx.store_id, ...payload };
      break;
    case "returns-create":
      functionName = "returns-create";
      functionBody = { store_id: ctx.store_id, ...payload };
      break;
    case "reports-summary":
      functionName = "reports-summary";
      functionBody = { store_id: ctx.store_id, ...payload };
      break;
    default:
      return json({ error: "unknown_action", reply: "Ação desconhecida." }, 400);
  }

  try {
    const fnUrl = `${SB_URL}/functions/v1/${functionName}`;
    const method = actionType === "reports-summary" ? "GET" : "POST";

    const fetchOpts: RequestInit = {
      method,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        ...(actionType !== "reports-summary" ? { "Idempotency-Key": idemKey } : {}),
      },
    };

    if (method === "POST") {
      fetchOpts.body = JSON.stringify(functionBody);
    }

    const result = await fetch(
      method === "GET"
        ? `${fnUrl}?${new URLSearchParams(functionBody as Record<string, string>)}`
        : fnUrl,
      fetchOpts,
    );

    const resultData = await result.json();

    await svc.from("ai_events").update({
      confirmed: true,
      result: { status: result.status, data: resultData },
    }).eq("id", event_id);

    const successReply = result.ok
      ? `✅ Ação executada com sucesso! ${JSON.stringify(resultData)}`
      : `❌ Erro ao executar: ${resultData.error || resultData.message || "Erro desconhecido"}`;

    await svc.from("ai_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: successReply,
    });

    return json({
      conversation_id: conversationId,
      reply: successReply,
      action_result: resultData,
      action_success: result.ok,
    }, 200);
  } catch (e) {
    console.error("Action execution error:", e);
    const errReply = "❌ Erro ao executar a ação. Tente novamente.";
    await svc.from("ai_messages").insert({ conversation_id: conversationId, role: "assistant", content: errReply });
    return json({ conversation_id: conversationId, reply: errReply }, 500);
  }
}

async function loadLiveStoreData(svc: ReturnType<typeof createClient>, storeId: string): Promise<string> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0);
    const weekStart = new Date(); weekStart.setUTCDate(weekStart.getUTCDate() - 7);

    const [todaySalesRes, monthSalesRes, weekSalesRes, lowStockRes, receivableRes, payableRes, topProdRes] = await Promise.all([
      svc.from("sales").select("net_total").eq("store_id", storeId).eq("status","paid").is("deleted_at", null).gte("created_at", today),
      svc.from("sales").select("net_total, profit_gross").eq("store_id", storeId).eq("status","paid").is("deleted_at", null).gte("created_at", monthStart.toISOString()),
      svc.from("sales").select("net_total").eq("store_id", storeId).eq("status","paid").is("deleted_at", null).gte("created_at", weekStart.toISOString()),
      svc.from("products").select("name, on_hand, minimum_stock").eq("store_id", storeId).eq("is_active", true),
      svc.from("sales").select("amount_pending, due_date").eq("store_id", storeId).is("deleted_at", null).in("payment_status", ["pending","partial"]),
      svc.from("accounts_payable").select("amount, due_date, description").eq("store_id", storeId).eq("status","pending"),
      svc.from("sale_items").select("qty, line_total, products!inner(name, store_id)").eq("products.store_id", storeId).limit(500),
    ]);

    const todayCount = todaySalesRes.data?.length || 0;
    const todayRev = (todaySalesRes.data || []).reduce((s, r: any) => s + Number(r.net_total||0), 0);
    const monthRev = (monthSalesRes.data || []).reduce((s, r: any) => s + Number(r.net_total||0), 0);
    const monthProfit = (monthSalesRes.data || []).reduce((s, r: any) => s + Number(r.profit_gross||0), 0);
    const weekRev = (weekSalesRes.data || []).reduce((s, r: any) => s + Number(r.net_total||0), 0);

    const lowStock = (lowStockRes.data || []).filter((p: any) => p.on_hand <= p.minimum_stock);
    const lowStockTop = lowStock.slice(0, 5).map((p: any) => `${p.name} (${p.on_hand}/${p.minimum_stock})`).join(", ");

    const receivablePending = (receivableRes.data || []).reduce((s, r: any) => s + Number(r.amount_pending||0), 0);
    const receivableOverdue = (receivableRes.data || []).filter((r: any) => r.due_date && r.due_date < today)
      .reduce((s, r: any) => s + Number(r.amount_pending||0), 0);

    const payablePending = (payableRes.data || []).reduce((s, r: any) => s + Number(r.amount||0), 0);
    const payableOverdue = (payableRes.data || []).filter((r: any) => r.due_date < today);
    const payableOverdueAmt = payableOverdue.reduce((s, r: any) => s + Number(r.amount||0), 0);
    const payableOverdueList = payableOverdue.slice(0, 3).map((r: any) => `${r.description} (${r.due_date})`).join("; ");

    // top 3 mais vendidos por receita
    const aggMap = new Map<string, number>();
    for (const it of (topProdRes.data || []) as any[]) {
      const name = it.products?.name || "?";
      aggMap.set(name, (aggMap.get(name) || 0) + Number(it.line_total || 0));
    }
    const top3 = [...aggMap.entries()].sort((a,b) => b[1]-a[1]).slice(0,3)
      .map(([n,v]) => `${n} (R$ ${v.toFixed(2)})`).join(", ");

    const f = (n: number) => `R$ ${n.toFixed(2)}`;
    return [
      `Vendas hoje: ${todayCount} venda(s), faturamento ${f(todayRev)}`,
      `Vendas 7 dias: ${f(weekRev)}`,
      `Mês atual: receita ${f(monthRev)}, lucro ${f(monthProfit)}`,
      `Estoque baixo: ${lowStock.length} produto(s)${lowStockTop ? ` — top: ${lowStockTop}` : ""}`,
      `A receber: ${f(receivablePending)} (vencido: ${f(receivableOverdue)})`,
      `A pagar pendente: ${f(payablePending)}; vencidas: ${payableOverdue.length} (${f(payableOverdueAmt)})${payableOverdueList ? ` — ${payableOverdueList}` : ""}`,
      `Top produtos por receita: ${top3 || "—"}`,
    ].join("\n");
  } catch (e) {
    console.error("loadLiveStoreData error:", e);
    return "(dados indisponíveis no momento)";
  }
}

// ===== Query tools (RLS via userClient) =====
async function runQueryTool(client: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const target = String(payload.target || "");
  try {
    if (target === "notifications") {
      const limit = Number(payload.limit ?? 10);
      const { data, error } = await client
        .from("notifications")
        .select("id, type, severity, title, description, link, created_at, read_at")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    }
    if (target === "product_history") {
      let productId = String(payload.product_id || "");
      let productName = String(payload.product_name || "").slice(0, 100);
      if (!productId && productName) {
        const safe = productName.replace(/[,().*%\\]/g, "").trim();
        if (safe) {
          const { data: matches } = await client
            .from("products")
            .select("id, name")
            .or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`)
            .limit(1);
          if (matches?.[0]) { productId = matches[0].id; productName = matches[0].name; }
        }
      }
      if (!productId) return { error: "produto_nao_encontrado" };
      const { data, error } = await client.rpc("product_history", { p_product_id: productId });
      if (error) throw error;
      return { product_id: productId, product_name: productName, history: (data || []).slice(0, 20) };
    }
    if (target === "customer_360") {
      let customerId = String(payload.customer_id || "");
      const customerName = String(payload.customer_name || "").slice(0, 100);
      if (!customerId && customerName) {
        const safe = customerName.replace(/[,().*%\\]/g, "").trim();
        if (safe) {
          const { data: matches } = await client
            .from("customers")
            .select("id, name")
            .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`)
            .limit(1);
          if (matches?.[0]) customerId = matches[0].id;
        }
      }
      if (!customerId) return { error: "cliente_nao_encontrado" };
      const { data, error } = await client.rpc("customer_360", { p_customer_id: customerId });
      if (error) throw error;
      return data;
    }
    if (target === "dashboard_intelligence") {
      const limit = Number(payload.limit ?? 5);
      const { data, error } = await client.rpc("dashboard_intelligence", { p_limit: limit });
      if (error) throw error;
      return data;
    }
    return { error: "unknown_target" };
  } catch (e) {
    console.error("runQueryTool error:", e);
    return { error: String((e as Error).message || e) };
  }
}

interface QuerySummary { text: string; link?: { route: string; label: string } }

function summarizeQueryResult(target: string, result: unknown): QuerySummary {
  if (!result) return { text: "Não encontrei resultados." };
  const r: any = result;
  if (r.error) return { text: `⚠️ Não foi possível consultar: ${r.error}` };

  if (target === "notifications") {
    if (!Array.isArray(r) || r.length === 0) return { text: "🎉 Nenhuma notificação ativa.", link: { route: "/dashboard", label: "Ir ao dashboard" } };
    const lines = r.slice(0, 5).map((n: any) =>
      `• [${n.severity}] ${n.title}${n.description ? ` — ${n.description}` : ""}`,
    );
    // Use o link da primeira notificação (mais relevante) se existir
    const firstLink = r.find((n: any) => n.link)?.link || "/dashboard";
    return { text: `📬 ${r.length} alerta(s):\n${lines.join("\n")}`, link: { route: firstLink, label: "Abrir alertas" } };
  }
  if (target === "product_history") {
    const hist = r.history || [];
    if (!Array.isArray(hist) || hist.length === 0) {
      return { text: `Sem histórico para ${r.product_name || "esse produto"}.`, link: { route: "/produtos", label: "Ver produtos" } };
    }
    const lines = hist.slice(0, 8).map((h: any) => {
      const dt = new Date(h.occurred_at).toLocaleString("pt-BR");
      const who = h.actor_name || "sistema";
      return `• ${dt} — ${h.event_type}${h.qty ? ` (${h.qty})` : ""} por ${who}`;
    });
    return {
      text: `📜 Histórico de ${r.product_name || "produto"} (${hist.length} eventos):\n${lines.join("\n")}`,
      link: { route: "/produtos", label: "Abrir produto" },
    };
  }
  if (target === "customer_360") {
    const t = r.totals || {};
    const cid = r.customer?.id;
    return {
      text: `👤 ${r.customer?.name || "Cliente"}: ${t.sales_count || 0} compra(s), gasto total R$ ${Number(t.total_spent || 0).toFixed(2)}, pendente R$ ${Number(t.total_pending || 0).toFixed(2)}, ticket médio R$ ${Number(t.avg_ticket || 0).toFixed(2)}.`,
      link: cid ? { route: `/clientes?focus=${cid}`, label: "Abrir ficha do cliente" } : { route: "/clientes", label: "Ver clientes" },
    };
  }
  if (target === "dashboard_intelligence") {
    if (!Array.isArray(r) || r.length === 0) return { text: "🎉 Tudo em ordem.", link: { route: "/dashboard", label: "Ver dashboard" } };
    const lines = r.slice(0, 5).map((x: any) => `• [${x.severity}] ${x.title} — ${x.description}`);
    const firstLink = r.find((x: any) => x.link)?.link || "/dashboard";
    return { text: `🧠 Top recomendações:\n${lines.join("\n")}`, link: { route: firstLink, label: "Abrir recomendação" } };
  }
  return { text: "Consulta executada." };
}

