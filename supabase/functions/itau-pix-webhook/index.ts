// Estokfy Connect — Edge Function: itau-pix-webhook
//
// Recebe a notificação de PIX recebido direto do Itaú (API PIX Recebimentos,
// devportal.itau.com.br), sem depender de agregador terceiro (Pluggy/Open
// Finance). Alternativa mais "direta" pedida pelo usuário ao caminho Pluggy.
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
// mínima de defesa enquanto isso não é confirmado, exige um token compartilhado
// (ITAU_WEBHOOK_TOKEN) que deve ser embutido na URL cadastrada no Itaú, ex:
//   https://<PROJECT_REF>.supabase.co/functions/v1/itau-pix-webhook?token=...
//
// Env vars obrigatórias:
//   ITAU_WEBHOOK_TOKEN            — token compartilhado (query param `token`)
//   ITAU_TARGET_STORE_ID          — store_id da loja Estokfy dona da conta Itaú
//   ITAU_TARGET_BANK_CONNECTION_ID — id em bank_connections representando essa conta
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

  const expectedToken = Deno.env.get("ITAU_WEBHOOK_TOKEN");
  const storeId = Deno.env.get("ITAU_TARGET_STORE_ID");
  const bankConnectionId = Deno.env.get("ITAU_TARGET_BANK_CONNECTION_ID");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!expectedToken || !storeId || !bankConnectionId) {
    console.error("[itau-pix-webhook] Variáveis de ambiente não configuradas (token/store/connection)");
    return new Response(JSON.stringify({ error: "Integração Itaú não configurada" }), {
      status: 503, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const providedToken = url.searchParams.get("token") ?? req.headers.get("x-itau-webhook-token");
  if (providedToken !== expectedToken) {
    console.warn("[itau-pix-webhook] Token ausente ou inválido — rejeitando");
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }

  const rawBody = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS });
  }

  console.log(`[itau-pix-webhook] payload recebido: ${rawBody.slice(0, 500)}`);

  const events = extractPixEvents(payload);
  if (events.length === 0) {
    console.warn("[itau-pix-webhook] Nenhum evento PIX reconhecido no payload — verificar formato real do Itaú");
    return new Response(JSON.stringify({ received: true, processed: 0 }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

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

  console.log(`[itau-pix-webhook] processados=${processed} novos=${newCount}`);

  return new Response(JSON.stringify({ received: true, processed, new: newCount, matchResult }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
