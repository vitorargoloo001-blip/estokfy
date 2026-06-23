import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("AUTOMATION_INTERNAL_SECRET") ?? "";

interface RunRequest {
  automation_id: string;
  store_id: string;
  trigger_type?: "manual" | "cron" | "ai" | "test";
  user_jwt?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
      },
    });
  }

  const internalSecret = req.headers.get("x-internal-secret");
  const authHeader = req.headers.get("authorization");

  // Validar origem: secret interno (cron) OU JWT de usuário (manual)
  const isCron = INTERNAL_SECRET && internalSecret === INTERNAL_SECRET;
  const isUserCall = !!authHeader;
  if (!isCron && !isUserCall) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: RunRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON inválido" }, 400);
  }

  const { automation_id, store_id, trigger_type = "manual", user_jwt } = body;
  if (!automation_id || !store_id) {
    return json({ error: "automation_id e store_id são obrigatórios" }, 400);
  }

  // Cliente service_role para operações privilegiadas
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Buscar automação e validar store_id
  const { data: automation, error: autoErr } = await supabase
    .from("connect_automations")
    .select("*")
    .eq("id", automation_id)
    .eq("store_id", store_id)
    .single();

  if (autoErr || !automation) {
    return json({ error: "Automação não encontrada" }, 404);
  }

  // Verificar licença Connect ativa
  const { data: license } = await supabase
    .from("connect_licenses")
    .select("status")
    .eq("store_id", store_id)
    .eq("status", "active")
    .maybeSingle();

  if (!license) {
    return json({ error: "Licença Connect inativa para esta loja" }, 403);
  }

  // Gerar chave de idempotência para evitar execução duplicada
  const now = new Date();
  const hourSlot = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const idempotencyKey = trigger_type === "cron"
    ? `${automation_id}:${automation.schedule_config?.frequency ?? "daily"}:${hourSlot}`
    : null; // manual não tem idempotência

  // Iniciar execução
  const { data: runId, error: startErr } = await supabase.rpc("start_automation_run", {
    p_automation_id: automation_id,
    p_store_id: store_id,
    p_trigger_type: trigger_type,
    p_idempotency_key: idempotencyKey,
  });

  if (startErr) {
    return json({ error: startErr.message }, 500);
  }

  if (!runId) {
    return json({ skipped: true, reason: "Já executada no período (idempotência)" }, 200);
  }

  const startTime = Date.now();
  let result: Record<string, unknown> = {};
  let status: string = "success";
  let errorMsg: string | null = null;
  let itemsAffected = 0;

  try {
    await log(supabase, runId, store_id, "info", `Iniciando automação: ${automation.type}`);

    switch (automation.type) {
      case "auto_reconciliation":
        ({ result, itemsAffected } = await runAutoReconciliation(supabase, automation, runId, store_id));
        break;
      case "divergence_alert":
        ({ result, itemsAffected } = await runDivergenceAlert(supabase, automation, runId, store_id));
        break;
      case "bank_disconnected":
        ({ result, itemsAffected } = await runBankDisconnected(supabase, automation, runId, store_id));
        break;
      case "daily_report":
        ({ result, itemsAffected } = await runDailyReport(supabase, automation, runId, store_id));
        break;
      case "weekly_report":
        ({ result, itemsAffected } = await runWeeklyReport(supabase, automation, runId, store_id));
        break;
      case "overdue_collection":
        ({ result, itemsAffected } = await runOverdueCollection(supabase, automation, runId, store_id));
        status = "pending_approval"; // sempre requer aprovação
        break;
      case "cashflow_risk":
        ({ result, itemsAffected } = await runCashflowRisk(supabase, automation, runId, store_id));
        break;
      default:
        throw new Error(`Tipo de automação desconhecido: ${automation.type}`);
    }

    await log(supabase, runId, store_id, "info", `Automação concluída com sucesso. ${itemsAffected} item(s) afetado(s).`);
  } catch (err) {
    status = "error";
    errorMsg = err instanceof Error ? err.message : String(err);
    await log(supabase, runId, store_id, "error", `Erro: ${errorMsg}`);
  }

  const duration = Date.now() - startTime;

  await supabase.rpc("complete_automation_run", {
    p_run_id: runId,
    p_status: status,
    p_result: result,
    p_error: errorMsg,
    p_items: itemsAffected,
    p_duration_ms: duration,
  });

  return json({ run_id: runId, status, items_affected: itemsAffected, duration_ms: duration, result }, 200);
});

// ── Execuções por tipo ────────────────────────────────────────────────

async function runAutoReconciliation(supabase: ReturnType<typeof createClient>, auto: any, runId: string, storeId: string) {
  const minScore = Number(auto.config?.min_confidence ?? 85);
  await log(supabase, runId, storeId, "info", `Rodando conciliação automática com score mínimo ${minScore}`);

  const { data, error } = await supabase.rpc("connect_run_matching", { p_store_id: storeId });
  if (error) throw new Error(error.message);

  const matched = Array.isArray(data) ? data.filter((m: any) => (m.confidence_score ?? 0) >= minScore) : [];

  // Confirmar matches de alta confiança automaticamente
  let confirmed = 0;
  for (const match of matched) {
    const { error: confirmErr } = await supabase.rpc("confirm_reconciliation", {
      p_match_id: match.id,
      p_store_id: storeId,
    });
    if (!confirmErr) confirmed++;
  }

  if (confirmed > 0) {
    await supabase.rpc("create_connect_notification", {
      p_store_id: storeId,
      p_type: "auto_reconciliation",
      p_title: `⚡ ${confirmed} transação(ões) conciliada(s) automaticamente`,
      p_body: `A conciliação automática confirmou ${confirmed} match(es) com score ≥${minScore}.`,
      p_severity: "info",
      p_channel: "internal",
      p_automation_id: auto.id,
      p_run_id: runId,
      p_metadata: { confirmed, min_score: minScore },
    });
  }

  return { result: { confirmed, min_score: minScore }, itemsAffected: confirmed };
}

async function runDivergenceAlert(supabase: ReturnType<typeof createClient>, auto: any, runId: string, storeId: string) {
  const minDiverg = Number(auto.config?.min_divergences ?? 1);

  const { count } = await supabase
    .from("bank_transactions")
    .select("*", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("status", "divergent");

  const divCount = count ?? 0;
  await log(supabase, runId, storeId, "info", `${divCount} divergência(s) encontrada(s)`);

  if (divCount >= minDiverg) {
    const severity = divCount > 10 ? "critical" : divCount > 3 ? "warning" : "info";
    await supabase.rpc("create_connect_notification", {
      p_store_id: storeId,
      p_type: "divergence_alert",
      p_title: `⚠️ ${divCount} divergência(s) pendente(s)`,
      p_body: `Existem ${divCount} transações bancárias divergentes aguardando revisão manual.`,
      p_severity: severity,
      p_channel: "internal",
      p_automation_id: auto.id,
      p_run_id: runId,
      p_metadata: { divergent_count: divCount },
    });
  }

  return { result: { divergent_count: divCount }, itemsAffected: divCount };
}

async function runBankDisconnected(supabase: ReturnType<typeof createClient>, auto: any, runId: string, storeId: string) {
  const maxHours = Number(auto.config?.max_hours_offline ?? 24);
  const cutoff = new Date(Date.now() - maxHours * 3600_000).toISOString();

  const { data: offlineBanks } = await supabase
    .from("bank_connections")
    .select("id, bank_name, last_sync_at, status")
    .eq("store_id", storeId)
    .in("status", ["error", "disconnected"])
    .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`);

  const count = offlineBanks?.length ?? 0;
  await log(supabase, runId, storeId, "info", `${count} banco(s) offline por mais de ${maxHours}h`);

  if (count > 0) {
    const names = (offlineBanks ?? []).map((b: any) => b.bank_name).join(", ");
    await supabase.rpc("create_connect_notification", {
      p_store_id: storeId,
      p_type: "bank_disconnected",
      p_title: `🏦 ${count} banco(s) desconectado(s)`,
      p_body: `Conexão sem sincronização há mais de ${maxHours}h: ${names}.`,
      p_severity: "critical",
      p_channel: "internal",
      p_automation_id: auto.id,
      p_run_id: runId,
      p_metadata: { offline_count: count, banks: names },
    });
  }

  return { result: { offline_count: count, max_hours: maxHours }, itemsAffected: count };
}

async function runDailyReport(supabase: ReturnType<typeof createClient>, auto: any, runId: string, storeId: string) {
  const { data: summary } = await supabase.rpc("get_store_financial_summary", { p_store_id: storeId });

  if (!summary) {
    await log(supabase, runId, storeId, "warning", "Sem dados financeiros para o relatório diário");
    return { result: {}, itemsAffected: 0 };
  }

  const body = [
    `📊 Resumo de hoje:`,
    `• Recebido esta semana: R$ ${fmtBRL(summary.week_received)}`,
    `• Vendas esta semana: ${summary.week_sales_count}`,
    `• Conciliação: ${(summary.month_reconciliation_rate ?? 0).toFixed(1)}%`,
    `• Inadimplência: ${(summary.month_delinquency_rate ?? 0).toFixed(1)}%`,
  ].join("\n");

  await supabase.rpc("create_connect_notification", {
    p_store_id: storeId,
    p_type: "daily_report",
    p_title: `📊 Relatório diário — ${new Date().toLocaleDateString("pt-BR")}`,
    p_body: body,
    p_severity: "info",
    p_channel: "internal",
    p_automation_id: auto.id,
    p_run_id: runId,
    p_metadata: { summary },
  });

  return { result: { report_date: new Date().toISOString().slice(0, 10) }, itemsAffected: 1 };
}

async function runWeeklyReport(supabase: ReturnType<typeof createClient>, auto: any, runId: string, storeId: string) {
  const { data: summary } = await supabase.rpc("get_store_financial_summary", { p_store_id: storeId });

  const body = summary
    ? [
        `📅 Resumo semanal:`,
        `• Recebido no mês: R$ ${fmtBRL(summary.month_received)}`,
        `• Crescimento: ${summary.received_growth_pct != null ? (summary.received_growth_pct > 0 ? "+" : "") + summary.received_growth_pct.toFixed(1) + "%" : "—"}`,
        `• Divergências: ${summary.month_divergences}`,
        `• Previsão 30d: R$ ${fmtBRL(summary.forecast_30d)}`,
      ].join("\n")
    : "Sem dados disponíveis para o relatório semanal.";

  await supabase.rpc("create_connect_notification", {
    p_store_id: storeId,
    p_type: "weekly_report",
    p_title: `📅 Relatório semanal — semana ${getWeekNumber()}`,
    p_body: body,
    p_severity: "info",
    p_channel: "internal",
    p_automation_id: auto.id,
    p_run_id: runId,
    p_metadata: { week: getWeekNumber() },
  });

  return { result: { week: getWeekNumber() }, itemsAffected: 1 };
}

async function runOverdueCollection(supabase: ReturnType<typeof createClient>, auto: any, runId: string, storeId: string) {
  const minDays = Number(auto.config?.min_days_overdue ?? 1);
  const minAmount = Number(auto.config?.min_amount ?? 0);
  const cutoffDate = new Date(Date.now() - minDays * 86400_000).toISOString().slice(0, 10);

  const { data: debtors } = await supabase
    .from("sales")
    .select("customer_id, customers(name, email, phone), amount_pending, due_date")
    .eq("store_id", storeId)
    .in("payment_status", ["pending", "partial"])
    .lte("due_date", cutoffDate)
    .gte("amount_pending", minAmount)
    .is("deleted_at", null)
    .limit(50);

  // Agregar por cliente
  const byCustomer: Record<string, any> = {};
  for (const sale of debtors ?? []) {
    const cid = sale.customer_id ?? "unknown";
    if (!byCustomer[cid]) {
      byCustomer[cid] = { name: (sale.customers as any)?.name ?? "Sem nome", total: 0, count: 0 };
    }
    byCustomer[cid].total += Number(sale.amount_pending ?? 0);
    byCustomer[cid].count++;
  }

  const customers = Object.values(byCustomer).sort((a: any, b: any) => b.total - a.total);
  const totalOverdue = customers.reduce((s: number, c: any) => s + c.total, 0);

  await log(supabase, runId, storeId, "info", `${customers.length} cliente(s) com débito vencido. Total: R$ ${fmtBRL(totalOverdue)}`);

  return {
    result: {
      customers,
      total_overdue: totalOverdue,
      customer_count: customers.length,
      message_template: `Olá {nome}, identificamos um débito de R$ {valor} com vencimento em {data}. Entre em contato para regularizar.`,
      note: "Aguardando aprovação para envio. Nenhuma mensagem foi enviada.",
    },
    itemsAffected: customers.length,
  };
}

async function runCashflowRisk(supabase: ReturnType<typeof createClient>, auto: any, runId: string, storeId: string) {
  const threshold = Number(auto.config?.at_risk_threshold_pct ?? 30);

  const { data: forecast } = await supabase.rpc("get_cashflow_forecast", { p_store_id: storeId });
  if (!forecast) return { result: {}, itemsAffected: 0 };

  const atRisk = Number(forecast.at_risk_30d ?? 0);
  const confirmed = Number(forecast.confirmed_30d ?? 0);
  const total = atRisk + confirmed;
  const riskPct = total > 0 ? (atRisk / total) * 100 : 0;

  await log(supabase, runId, storeId, "info", `Risco de fluxo: ${riskPct.toFixed(1)}% (limite: ${threshold}%)`);

  if (riskPct >= threshold) {
    await supabase.rpc("create_connect_notification", {
      p_store_id: storeId,
      p_type: "cashflow_risk",
      p_title: `📈 Risco de fluxo de caixa: ${riskPct.toFixed(0)}%`,
      p_body: `R$ ${fmtBRL(atRisk)} em risco dos R$ ${fmtBRL(total)} previstos nos próximos 30 dias.`,
      p_severity: riskPct > 60 ? "critical" : "warning",
      p_channel: "internal",
      p_automation_id: auto.id,
      p_run_id: runId,
      p_metadata: { at_risk: atRisk, total_forecast: total, risk_pct: riskPct },
    });
  }

  return { result: { at_risk: atRisk, confirmed, risk_pct: riskPct }, itemsAffected: riskPct >= threshold ? 1 : 0 };
}

// ── Helpers ────────────────────────────────────────────────────────────

async function log(supabase: ReturnType<typeof createClient>, runId: string, storeId: string, level: string, message: string) {
  await supabase.rpc("add_automation_log", {
    p_run_id: runId,
    p_store_id: storeId,
    p_level: level,
    p_message: message,
    p_details: null,
  });
}

function fmtBRL(v: number | null | undefined) {
  if (v == null) return "0,00";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getWeekNumber() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
