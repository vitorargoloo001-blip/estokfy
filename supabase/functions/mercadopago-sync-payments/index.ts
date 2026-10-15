// Estokfy Connect — Edge Function: mercadopago-sync-payments
//
// Busca incremental dos pagamentos da conta Mercado Pago
// (GET /v1/payments/search por date_last_updated) e grava cada um via
// upsert_bank_transaction_mercadopago (idempotente). Roda o motor de
// conciliação existente quando algo novo ficou casável.
//
// Dois modos:
//   - usuário ("Sincronizar agora"): Authorization: Bearer <jwt>,
//     body { connectionId?: uuid } — só conexões da loja do usuário
//   - cron (pg_cron + pg_net, migration 20261015000002): header
//     x-cron-secret conferido no Vault — todas as conexões MP ativas
//
// Deploy com --no-verify-jwt: o cron não manda JWT; a função valida tudo
// por conta própria.
//
// Env: MP_ACCESS_TOKEN, MP_V1_STORE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPaymentsSearchPath,
  MP_PROVIDER,
  MP_SEARCH_MAX_OFFSET,
  MP_SEARCH_PAGE_SIZE,
  mpFetch,
  syncWindowStart,
  type MpPayment,
} from "../_shared/mercadopago.ts";
import {
  authorizeConnectCaller,
  CONNECT_MANAGER_ROLES,
  connectLog,
  CORS,
  getAccessToken,
  ingestPayment,
  isConnectModuleActive,
  json,
  MP_CONNECTION_COLUMNS,
  runMatching,
  serviceClient,
  type MpConnection,
} from "../_shared/mercadopago-server.ts";

const TIME_BUDGET_MS = 100_000;

interface SyncSummary {
  connectionId: string;
  storeId: string;
  inserted: number;
  updated: number;
  skipped: number;
  partial: boolean;
  matchResult: unknown;
  error?: string;
}

async function syncConnection(
  supabase: SupabaseClient,
  conn: MpConnection,
  source: "user" | "cron",
  deadline: number,
): Promise<SyncSummary> {
  const token = getAccessToken(conn);
  const endIso = new Date().toISOString();
  const cursor = typeof conn.metadata?.sync_cursor === "string" ? conn.metadata.sync_cursor : null;

  // "Só a partir de agora": a janela nunca começa antes da conexão.
  let beginIso = syncWindowStart(cursor, conn.connected_at ?? endIso);
  if (conn.connected_at && new Date(beginIso) < new Date(conn.connected_at)) {
    beginIso = new Date(conn.connected_at).toISOString();
  }

  const summary: SyncSummary = {
    connectionId: conn.id, storeId: conn.store_id,
    inserted: 0, updated: 0, skipped: 0, partial: false, matchResult: null,
  };
  let anyMatchable = false;
  let lastSeenUpdated: string | null = null;
  let offset = 0;

  for (;;) {
    const page = await mpFetch<{ results?: MpPayment[]; paging?: { total?: number } }>(
      buildPaymentsSearchPath(beginIso, endIso, offset),
      token,
    );
    const results = page.results ?? [];

    for (const payment of results) {
      const r = await ingestPayment(supabase, conn, payment);
      if (r.isNew) summary.inserted++;
      else if (r.action.startsWith("skipped")) summary.skipped++;
      else summary.updated++;
      if (r.matchable) anyMatchable = true;
      if (payment.date_last_updated) lastSeenUpdated = payment.date_last_updated;
    }

    offset += MP_SEARCH_PAGE_SIZE;
    const total = page.paging?.total ?? 0;
    if (results.length === 0 || offset >= total) break;
    if (offset >= MP_SEARCH_MAX_OFFSET || Date.now() > deadline) {
      // Ordenado por date_last_updated asc: tudo até lastSeenUpdated já foi
      // processado. O próximo sync continua daí.
      summary.partial = true;
      break;
    }
  }

  const newCursor = summary.partial && lastSeenUpdated ? lastSeenUpdated : endIso;
  await supabase
    .from("bank_connections")
    .update({ metadata: { ...(conn.metadata ?? {}), sync_cursor: newCursor, last_sync_source: source } })
    .eq("id", conn.id);

  const { count } = await supabase
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("bank_connection_id", conn.id);

  await supabase.rpc("update_bank_connection_sync_status", {
    p_bank_connection_id: conn.id,
    p_status: summary.partial ? "partial" : "success",
    p_error_message: null,
    p_total_transactions: count ?? null,
  });

  if (anyMatchable) summary.matchResult = await runMatching(supabase, conn.store_id);

  if (summary.inserted > 0 || summary.updated > 0 || source === "user") {
    await connectLog(
      supabase, conn.store_id, "sync",
      `Mercado Pago: ${summary.inserted} novo(s), ${summary.updated} atualizado(s)`,
      {
        source,
        window: { begin: beginIso, end: endIso },
        inserted: summary.inserted,
        updated: summary.updated,
        skipped: summary.skipped,
        partial: summary.partial,
      },
      conn.id,
    );
  }

  return summary;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = serviceClient();
  const deadline = Date.now() + TIME_BUDGET_MS;
  let source: "user" | "cron";
  let connections: MpConnection[];

  try {
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret) {
      const { data: ok } = await supabase.rpc("mercadopago_cron_secret_matches", { p_secret: cronSecret });
      if (ok !== true) return json({ error: "Não autorizado" }, 401);
      source = "cron";
      const { data } = await supabase
        .from("bank_connections")
        .select(MP_CONNECTION_COLUMNS)
        .eq("provider", MP_PROVIDER)
        .eq("is_active", true);
      connections = (data as MpConnection[] | null) ?? [];
    } else {
      const caller = await authorizeConnectCaller(supabase, req, CONNECT_MANAGER_ROLES);
      if (caller instanceof Response) return caller;
      source = "user";

      const body = await req.json().catch(() => ({})) as { connectionId?: string };
      let query = supabase
        .from("bank_connections")
        .select(MP_CONNECTION_COLUMNS)
        .eq("store_id", caller.storeId)
        .eq("provider", MP_PROVIDER)
        .eq("is_active", true);
      if (body.connectionId) query = query.eq("id", body.connectionId);
      const { data } = await query;
      connections = (data as MpConnection[] | null) ?? [];
      if (connections.length === 0) {
        return json({ error: "Nenhuma conexão Mercado Pago ativa" }, 404);
      }
    }
  } catch (err) {
    console.error("[mercadopago-sync-payments] auth", err);
    return json({ error: "Erro ao iniciar a sincronização" }, 500);
  }

  const results: SyncSummary[] = [];
  for (const conn of connections) {
    if (source === "cron" && !(await isConnectModuleActive(supabase, conn.store_id))) continue;
    try {
      results.push(await syncConnection(supabase, conn, source, deadline));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mercadopago-sync-payments] conexão ${conn.id}:`, message);
      await supabase.rpc("update_bank_connection_sync_status", {
        p_bank_connection_id: conn.id,
        p_status: "failed",
        p_error_message: message.slice(0, 500),
        p_total_transactions: null,
      });
      await connectLog(supabase, conn.store_id, "error", "Falha na sincronização do Mercado Pago", { source, error: message.slice(0, 500) }, conn.id, "error");
      results.push({
        connectionId: conn.id, storeId: conn.store_id,
        inserted: 0, updated: 0, skipped: 0, partial: false, matchResult: null, error: message,
      });
    }
  }

  const firstError = results.find((r) => r.error)?.error;
  return json(
    { success: !firstError, source, results, ...(firstError ? { error: firstError } : {}) },
    firstError && source === "user" ? 502 : 200,
  );
});
