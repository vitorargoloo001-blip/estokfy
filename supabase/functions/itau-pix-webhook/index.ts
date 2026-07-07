// Estokfy Connect — Edge Function: itau-pix-webhook
//
// Recebe a notificação de PIX recebido direto do Itaú (API PIX Recebimentos,
// devportal.itau.com.br), sem depender de agregador terceiro (Pluggy/Open
// Finance). Multi-tenant: a loja/conexão é descoberta pelo próprio token da
// URL (bank_connections.webhook_secret), gerado e exibido na tela de
// Conexões (create_itau_direct_connection) — nenhuma env var por loja é
// necessária, só SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (globais, já
// existentes em toda Edge Function).
//
// Formato do payload segue o padrão regulado pelo Bacen para webhooks de PIX
// recebido (mesmo contrato usado por todos os PSPs, incluindo Itaú):
//   { "pix": [ { "endToEndId", "txid", "valor", "horario", "pagador": {...} } ] }
// IMPORTANTE: isso foi construído a partir da spec pública do Bacen
// (github.com/bacen/pix-api), não do manual técnico privado do Itaú — o
// devportal só libera esse manual depois que a API PIX Recebimentos é
// concedida pelo gerente/relacionamento. Se o payload real do Itaú vier em
// formato diferente, ajustar `extractPixEvents` abaixo (o payload bruto fica
// logado para isso).
//
// Autenticação do webhook: o Itaú usa mTLS nas APIs regulatórias de Pix, mas
// a validação de certificado cliente não é algo que uma Edge Function comum
// consegue terminar sozinha — isso pode exigir um proxy/gateway na frente
// (revisar quando o manual técnico do Itaú estiver em mãos). Como camada
// mínima de defesa enquanto isso não é confirmado, o token por conexão
// (?token=<webhook_secret>) já funciona como bearer secret de posse.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PixEvent {
  endToEndId: string;
  txid?: string;
  valor: string | number;
  horario: string;
  pagador?: { nome?: string; cpf?: string; cnpj?: string };
}

function extractPixEvents(payload: unknown): PixEvent[] {
  if (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).pix)) {
    return (payload as { pix: PixEvent[] }).pix;
  }
  // Alguns PSPs mandam um único objeto pix na raiz em vez do array padrão.
  if (payload && typeof payload === "object" && "endToEndId" in (payload as Record<string, unknown>)) {
    return [payload as PixEvent];
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? req.headers.get("x-itau-webhook-token");
  if (!token) {
    console.warn("[itau-pix-webhook] Token ausente — rejeitando");
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }

  const { data: conn, error: connErr } = await supabase
    .from("bank_connections")
    .select("id, store_id")
    .eq("webhook_secret", token)
    .eq("provider", "itau_direct")
    .eq("is_active", true)
    .maybeSingle();

  if (connErr || !conn) {
    console.warn("[itau-pix-webhook] Token não corresponde a nenhuma conexão ativa");
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }

  const storeId = conn.store_id as string;
  const bankConnectionId = conn.id as string;

  const rawBody = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS });
  }

  console.log(`[itau-pix-webhook] store=${storeId} payload recebido: ${rawBody.slice(0, 500)}`);

  const events = extractPixEvents(payload);
  if (events.length === 0) {
    console.warn("[itau-pix-webhook] Nenhum evento PIX reconhecido no payload — verificar formato real do Itaú");
    return new Response(JSON.stringify({ received: true, processed: 0 }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let newCount = 0;

  for (const evt of events) {
    if (!evt.endToEndId || evt.valor == null || !evt.horario) {
      console.warn("[itau-pix-webhook] Evento incompleto, ignorando:", JSON.stringify(evt).slice(0, 200));
      continue;
    }

    const amount = Math.abs(Number(evt.valor));
    const txDate = evt.horario.split("T")[0];
    const payerName = evt.pagador?.nome ?? "desconhecido";

    const { data, error } = await supabase.rpc("upsert_bank_transaction_pluggy", {
      p_store_id: storeId,
      p_bank_connection_id: bankConnectionId,
      p_external_id: evt.endToEndId,
      p_transaction_date: txDate,
      p_amount: amount,
      p_transaction_type: "credit",
      p_description: `PIX recebido de ${payerName}`,
      p_method: "pix",
      p_bank_name: "Itaú",
      p_raw_data: evt,
    });

    if (error) {
      console.error(`[itau-pix-webhook] Erro ao gravar ${evt.endToEndId}:`, error.message);
      continue;
    }

    processed++;
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.is_new) newCount++;
  }

  let matchResult: unknown = null;
  if (newCount > 0) {
    const { data, error } = await supabase.rpc("_connect_run_matching_core", { p_store_id: storeId });
    if (error) {
      console.error("[itau-pix-webhook] Erro ao rodar matching:", error.message);
    } else {
      matchResult = data;
    }
  }

  await supabase
    .from("bank_connections")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: "success" })
    .eq("id", bankConnectionId);

  console.log(`[itau-pix-webhook] store=${storeId} processados=${processed} novos=${newCount}`);

  return new Response(JSON.stringify({ received: true, processed, new: newCount, matchResult }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
