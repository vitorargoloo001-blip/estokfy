// Estokfy — Edge Function: mercadopago-pix-reconcile
//
// Consulta no Mercado Pago as cobranças Pix em aberto e aplica o status no
// banco. Roda pelo cron (pg_cron + pg_net, migration 20261102000002), de 5 em
// 5 minutos.
//
// Por que existe: a venda só era quitada se a tela do Pix ficasse aberta
// (ela consulta a cada 5 s) ou se o aviso do webhook chegasse. Quando a
// vendedora fechava a tela antes do pagamento, a cobrança e a venda ficavam
// pendentes para sempre, mesmo com o dinheiro na conta.
//
// Auth: header x-cron-secret conferido no Vault (mercadopago_cron_secret_matches).
// Deploy com --no-verify-jwt: o cron não manda JWT do Supabase.
// Env: MP_PIX_ACCESS_TOKEN (ou MP_PIX_TEST_ACCESS_TOKEN), SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY

import { CORS, json, serviceClient } from "../_shared/mercadopago-server.ts";
import { pixAccessToken, syncPixOrder } from "../_shared/mercadopago-pix-server.ts";

// Poucas cobranças ficam abertas ao mesmo tempo; o limite protege o tempo da função.
// Sem janela de data: uma cobrança esquecida aberta há dias precisa ser
// consultada também. Depois que expira no Mercado Pago, ela sai do conjunto.
const BATCH = 20;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = serviceClient();

  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  const { data: authorized } = await supabase.rpc("mercadopago_cron_secret_matches", { p_secret: cronSecret });
  if (!authorized) return json({ error: "Unauthorized" }, 401);

  const token = pixAccessToken();
  if (!token) return json({ error: "Pix pelo Mercado Pago ainda não configurado" }, 503);

  const { data: charges, error } = await supabase
    .from("mercadopago_pix_charges")
    .select("id, mp_order_id")
    .in("status", ["creating", "pending"])
    .not("mp_order_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) return json({ error: error.message }, 500);

  let applied = 0;
  let failed = 0;
  for (const charge of charges ?? []) {
    try {
      const result = await syncPixOrder(supabase, token, charge.mp_order_id as string, charge.id as string);
      if (result) applied++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mercadopago-pix-reconcile] cobrança=${charge.id} ${message}`);
    }
  }

  return json({ checked: charges?.length ?? 0, applied, failed });
});
