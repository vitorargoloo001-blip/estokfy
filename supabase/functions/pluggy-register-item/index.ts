// Estokfy Connect — Edge Function: pluggy-register-item
// Chamado pelo frontend após callback do widget Pluggy (onSuccess).
// Recebe { itemId } → busca item + contas na Pluggy API → registra no banco.
// Dispara sincronização inicial de transações (últimos 90 dias).
//
// Env vars: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Pluggy GET ${path} falhou (${res.status}): ${await res.text()}`);
  return res.json();
}

function mapMethod(paymentMethod: string | undefined | null): string {
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

// ── Main ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const clientId     = Deno.env.get("PLUGGY_CLIENT_ID");
    const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: "Credenciais Pluggy não configuradas" }), {
        status: 503, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Autenticar usuário
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

    const { pluggyItemId } = await req.json() as { pluggyItemId: string };
    if (!pluggyItemId) {
      return new Response(JSON.stringify({ error: "pluggyItemId é obrigatório" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const apiKey = await getPluggyApiKey(clientId, clientSecret);

    // Buscar detalhes do item
    const item = await pluggyGet(apiKey, `/items/${pluggyItemId}`) as Record<string, unknown>;
    const connector = item.connector as Record<string, unknown> | undefined;

    // Buscar contas do item
    const accountsResp = await pluggyGet(apiKey, `/accounts?itemId=${pluggyItemId}`) as {
      results: Array<Record<string, unknown>>;
    };
    const accounts = accountsResp.results ?? [];

    // Preparar accounts_json para o RPC
    const accountsJson = accounts.map((a) => ({
      id:           a.id,
      name:         a.name,
      number:       a.number,
      routingNumber: a.routingNumber,
      type:         a.type,
      subtype:      a.subtype,
      balance:      a.balance,
      currencyCode: a.currencyCode,
    }));

    // Registrar via RPC autenticada
    const { data: regData, error: regErr } = await supabase.rpc("register_pluggy_item_auth", {
      p_store_id:         profile.store_id,
      p_pluggy_item_id:   pluggyItemId,
      p_institution_name: (connector?.name as string) ?? (item.institutionName as string) ?? "Banco",
      p_connector_id:     (connector?.id as number) ?? null,
      p_connector_name:   (connector?.name as string) ?? null,
      p_accounts:         accountsJson,
    });

    if (regErr) throw new Error("register_pluggy_item_auth: " + regErr.message);

    const reg = Array.isArray(regData) ? regData[0] : regData;
    const bankConnectionIds: string[] = reg?.bank_connection_ids ?? [];

    // Sincronização inicial: últimos 90 dias por conta
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 90);
    const from = fromDate.toISOString().split("T")[0];
    const to   = new Date().toISOString().split("T")[0];

    let txImported = 0;
    let txNew      = 0;

    for (const account of accounts) {
      const accountId  = account.id as string;
      const bankConnId = bankConnectionIds[accounts.indexOf(account)] ?? bankConnectionIds[0];
      if (!bankConnId) continue;

      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const txResp = await pluggyGet(
          apiKey,
          `/transactions?accountId=${accountId}&from=${from}&to=${to}&page=${page}&pageSize=500`
        ) as { results: Array<Record<string, unknown>>; totalPages: number };

        const txList = txResp.results ?? [];
        hasMore = page < (txResp.totalPages ?? 1);
        page++;

        for (const tx of txList) {
          const payData    = (tx.paymentData as Record<string, unknown>) ?? {};
          const method     = mapMethod(payData.paymentMethod as string);
          const txType     = (tx.type as string)?.toUpperCase() === "CREDIT" ? "credit" : "debit";
          const amount     = Math.abs(tx.amount as number);
          const txDate     = (tx.date as string).split("T")[0];
          const desc       = (tx.description as string) || (tx.descriptionRaw as string) || "";

          const { data: upsertData } = await supabase.rpc("upsert_bank_transaction_pluggy", {
            p_store_id:           profile.store_id,
            p_bank_connection_id: bankConnId,
            p_external_id:        tx.id as string,
            p_transaction_date:   txDate,
            p_amount:             amount,
            p_transaction_type:   txType,
            p_description:        desc,
            p_method:             method,
            p_bank_name:          (connector?.name as string) ?? "Banco",
            p_raw_data:           tx,
          });

          txImported++;
          const row = Array.isArray(upsertData) ? upsertData[0] : upsertData;
          if (row?.is_new) txNew++;
        }

        // Atualizar status da conexão bancária
        await supabase.rpc("update_bank_connection_sync_status", {
          p_bank_connection_id: bankConnId,
          p_status:             "success",
          p_total_transactions: txImported,
        });
      }
    }

    // Marcar item como sincronizado
    await supabase.rpc("mark_pluggy_item_synced", {
      p_pluggy_item_id: pluggyItemId,
    });

    // Disparar motor de conciliação automática
    const { data: matchData } = await supabase.rpc("connect_run_matching", {
      p_store_id: profile.store_id,
    });

    console.log(`[pluggy-register-item] store=${profile.store_id} item=${pluggyItemId} imported=${txImported} new=${txNew}`);

    return new Response(JSON.stringify({
      success:          true,
      pluggyItemDbId:   reg?.pluggy_item_db_id,
      bankConnectionIds,
      txImported,
      txNew,
      matchResult:      matchData,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[pluggy-register-item]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
