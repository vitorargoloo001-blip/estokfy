// Estokfy Connect — Edge Function: pluggy-sync-transactions
// Sincroniza transações de um item Pluggy ou de todos os itens ativos da loja.
// Chamado manualmente ("Sincronizar agora") ou por webhook.
// Idempotente: usa bank_reference = Pluggy TX ID.
//
// Body (JSON):
//   { storeId: UUID, pluggyItemId?: string, fromDate?: "YYYY-MM-DD", toDate?: "YYYY-MM-DD" }
//
// Chamada por webhook → inclui header "X-Internal-Secret" com SUPABASE_SERVICE_ROLE_KEY
// Chamada por usuário → inclui Authorization: Bearer <supabase_jwt>
//
// Env vars: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const PLUGGY_API = "https://api.pluggy.ai";

// ── Helpers ───────────────────────────────────────────────────────────

async function getPluggyApiKey(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${PLUGGY_API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) throw new Error(`Pluggy /auth falhou: ${await res.text()}`);
  const { apiKey } = await res.json();
  return apiKey as string;
}

async function pluggyGet(apiKey: string, path: string): Promise<unknown> {
  const res = await fetch(`${PLUGGY_API}${path}`, {
    headers: { "X-API-KEY": apiKey },
  });
  if (!res.ok) throw new Error(`Pluggy GET ${path} (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function mapMethod(paymentMethod: string | null | undefined): string {
  switch ((paymentMethod ?? "").toUpperCase()) {
    case "PIX":    return "pix";
    case "TED":    return "ted";
    case "DOC":    return "doc";
    case "BOLETO": return "boleto";
    case "CC":     return "credit_card";
    case "CD":     return "debit_card";
    case "CASH":   return "money";
    default:       return "other";
  }
}

async function syncAccountTransactions(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  storeId: string,
  accountId: string,
  bankConnId: string,
  bankName: string,
  from: string,
  to: string
): Promise<{ imported: number; newCount: number }> {
  let imported = 0;
  let newCount = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const txResp = await pluggyGet(
      apiKey,
      `/transactions?accountId=${accountId}&from=${from}&to=${to}&page=${page}&pageSize=500`
    ) as { results: Array<Record<string, unknown>>; totalPages: number; total: number };

    const txList   = txResp.results ?? [];
    const maxPages = txResp.totalPages ?? 1;
    hasMore = page < maxPages;
    page++;

    for (const tx of txList) {
      const payData = (tx.paymentData as Record<string, unknown>) ?? {};
      const method  = mapMethod(payData.paymentMethod as string);
      const txType  = (tx.type as string)?.toUpperCase() === "CREDIT" ? "credit" : "debit";
      const amount  = Math.abs((tx.amount as number) ?? 0);
      const txDate  = ((tx.date ?? tx.dateTime) as string).split("T")[0];
      const desc    = ((tx.description ?? tx.descriptionRaw) as string) || "";

      const { data } = await supabase.rpc("upsert_bank_transaction_pluggy", {
        p_store_id:           storeId,
        p_bank_connection_id: bankConnId,
        p_external_id:        tx.id as string,
        p_transaction_date:   txDate,
        p_amount:             amount,
        p_transaction_type:   txType,
        p_description:        desc,
        p_method:             method,
        p_bank_name:          bankName,
        p_raw_data:           tx,
      });

      imported++;
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.is_new) newCount++;
    }
  }

  return { imported, newCount };
}

// ── Main ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const clientId     = Deno.env.get("PLUGGY_CLIENT_ID");
    const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET");
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "Credenciais Pluggy não configuradas" }), {
        status: 503, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

    // ── Auth: aceita JWT de usuário OU secret interno (de webhook) ────
    const internalSecret = req.headers.get("x-internal-secret");
    const isInternal     = internalSecret === serviceKey;
    let storeId: string;

    if (isInternal) {
      // Chamada interna (de pluggy-webhook) — recebe storeId direto no body
      const body = await req.json() as {
        storeId: string;
        pluggyItemId?: string;
        fromDate?: string;
        toDate?: string;
      };
      storeId = body.storeId;

      if (!storeId) {
        return new Response(JSON.stringify({ error: "storeId obrigatório" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const apiKey = await getPluggyApiKey(clientId, clientSecret);
      return await runSync(supabase, apiKey, storeId, body.pluggyItemId, body.fromDate, body.toDate, CORS);

    } else {
      // Chamada autenticada por usuário
      const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), {
          status: 401, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("store_id")
        .eq("auth_user_id", user.id)
        .single();

      if (!profile?.store_id) {
        return new Response(JSON.stringify({ error: "Loja não encontrada" }), {
          status: 403, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      storeId = profile.store_id as string;

      const body = await req.json() as { pluggyItemId?: string; fromDate?: string; toDate?: string };
      const apiKey = await getPluggyApiKey(clientId, clientSecret);
      return await runSync(supabase, apiKey, storeId, body.pluggyItemId, body.fromDate, body.toDate, CORS);
    }

  } catch (err) {
    console.error("[pluggy-sync-transactions]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

async function runSync(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  storeId: string,
  pluggyItemIdFilter: string | undefined,
  fromDateParam: string | undefined,
  toDateParam: string | undefined,
  cors: Record<string, string>
): Promise<Response> {
  // Período default: últimos 30 dias para sincronizações recorrentes
  const to   = toDateParam   ?? new Date().toISOString().split("T")[0];
  const fromD = fromDateParam
    ? new Date(fromDateParam)
    : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
  const from = fromDateParam ?? fromD.toISOString().split("T")[0];

  // Buscar items da loja
  const { data: items, error: itemsErr } = await supabase.rpc("get_pluggy_items_for_sync", {
    p_store_id: storeId,
  });

  if (itemsErr) throw new Error("get_pluggy_items_for_sync: " + itemsErr.message);

  const itemList = (items as Array<{
    id: string;
    pluggy_item_id: string;
    institution_name: string;
    accounts_json: Array<{ id: string }>;
    bank_connection_ids: string[];
  }>) ?? [];

  // Filtrar por item específico se solicitado
  const filtered = pluggyItemIdFilter
    ? itemList.filter((i) => i.pluggy_item_id === pluggyItemIdFilter)
    : itemList;

  if (filtered.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "Nenhum item ativo para sincronizar", txImported: 0 }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let totalImported = 0;
  let totalNew      = 0;
  const results: Array<{ pluggyItemId: string; institution: string; imported: number; new: number }> = [];

  for (const item of filtered) {
    const accounts = (item.accounts_json as Array<{ id: string }>) ?? [];
    const bankConnIds = (item.bank_connection_ids as string[]) ?? [];

    // Se não há accounts_json, tentar buscar da API
    let accountList = accounts;
    if (accountList.length === 0) {
      const resp = await pluggyGet(apiKey, `/accounts?itemId=${item.pluggy_item_id}`) as {
        results: Array<{ id: string }>;
      };
      accountList = resp.results ?? [];
    }

    let itemImported = 0;
    let itemNew      = 0;

    for (let ai = 0; ai < accountList.length; ai++) {
      const account    = accountList[ai];
      const bankConnId = bankConnIds[ai] ?? bankConnIds[0];
      if (!bankConnId || !account?.id) continue;

      const { imported, newCount } = await syncAccountTransactions(
        supabase, apiKey, storeId,
        account.id, bankConnId,
        item.institution_name ?? "Banco",
        from, to
      );

      itemImported += imported;
      itemNew      += newCount;

      await supabase.rpc("update_bank_connection_sync_status", {
        p_bank_connection_id: bankConnId,
        p_status:             "success",
        p_total_transactions: itemImported,
      });
    }

    // Marcar item como sincronizado
    await supabase.rpc("mark_pluggy_item_synced", {
      p_pluggy_item_id: item.pluggy_item_id,
    });

    totalImported += itemImported;
    totalNew      += itemNew;
    results.push({
      pluggyItemId: item.pluggy_item_id,
      institution:  item.institution_name,
      imported:     itemImported,
      new:          itemNew,
    });

    console.log(`[sync] store=${storeId} item=${item.pluggy_item_id} imported=${itemImported} new=${itemNew}`);
  }

  // Motor de conciliação automática
  let matchResult: unknown = null;
  if (totalNew > 0) {
    const { data } = await supabase.rpc("connect_run_matching", { p_store_id: storeId });
    matchResult = data;
  }

  return new Response(JSON.stringify({
    success:      true,
    period:       { from, to },
    txImported:   totalImported,
    txNew:        totalNew,
    items:        results,
    matchResult,
  }), { headers: { ...cors, "Content-Type": "application/json" } });
}
