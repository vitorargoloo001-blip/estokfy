// Estokfy Connect — Edge Function: mercadopago-webhook
//
// Recebe as notificações Webhooks da aplicação "Estokfy Connect" no
// Mercado Pago. O POST é tratado só como AVISO: valida a assinatura,
// descobre a conexão pelo user_id e relê o pagamento direto na API
// oficial (GET /v1/payments/{id}) — valor e status nunca vêm do corpo da
// notificação. Gravação idempotente (mesmo bank_reference), então
// reentregas e payment.created + payment.updated do mesmo id viram UMA
// linha.
//
// Deploy com --no-verify-jwt (o Mercado Pago não manda JWT do Supabase).
// O Mercado Pago espera HTTP 200/201 em até 22 segundos.
//
// Env: MP_WEBHOOK_SECRET, MP_ACCESS_TOKEN, MP_V1_STORE_ID,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { MpApiError, mpFetch, verifyMpSignature, type MpPayment } from "../_shared/mercadopago.ts";
import {
  connectLog,
  CORS,
  findActiveConnectionByMpUser,
  getAccessToken,
  ingestPayment,
  isConnectModuleActive,
  json,
  runMatching,
  serviceClient,
} from "../_shared/mercadopago-server.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const dataIdFromQuery = url.searchParams.get("data.id");
  const rawBody = await req.text();

  const valid = await verifyMpSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId: dataIdFromQuery,
    secret: Deno.env.get("MP_WEBHOOK_SECRET"),
  });
  if (!valid) {
    console.warn("[mercadopago-webhook] assinatura inválida — rejeitado");
    return json({ error: "Assinatura inválida" }, 401);
  }

  let body: { type?: string; topic?: string; action?: string; user_id?: number | string; data?: { id?: string | number } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const type = body.type ?? body.topic;
  if (type !== "payment") return json({ received: true, ignored: "tipo_nao_tratado", type });

  const paymentId = body.data?.id != null ? String(body.data.id) : "";
  // O data.id assinado é o da query; o do corpo precisa ser o mesmo.
  if (!paymentId || !dataIdFromQuery || dataIdFromQuery.toLowerCase() !== paymentId.toLowerCase()) {
    return json({ error: "data.id ausente ou inconsistente" }, 400);
  }

  const supabase = serviceClient();
  const conn = body.user_id != null ? await findActiveConnectionByMpUser(supabase, String(body.user_id)) : null;
  if (!conn) {
    console.warn(`[mercadopago-webhook] nenhuma conexão ativa para user_id=${body.user_id}`);
    return json({ received: true, ignored: "sem_conexao_ativa" });
  }
  if (!(await isConnectModuleActive(supabase, conn.store_id))) {
    return json({ received: true, ignored: "modulo_connect_inativo" });
  }

  try {
    const token = getAccessToken(conn);
    const payment = await mpFetch<MpPayment>(`/v1/payments/${encodeURIComponent(paymentId)}`, token, {
      retries: 1,
      timeoutMs: 7000,
    });
    const result = await ingestPayment(supabase, conn, payment);
    const matchResult = result.matchable ? await runMatching(supabase, conn.store_id) : null;

    await supabase.from("bank_connections").update({ last_sync_at: new Date().toISOString() }).eq("id", conn.id);
    await connectLog(supabase, conn.store_id, "webhook", `Mercado Pago: pagamento ${paymentId} (${result.action})`, {
      action: body.action ?? null,
      payment_id: paymentId,
      result: result.action,
      matchResult,
    }, conn.id);

    return json({ received: true, action: result.action });
  } catch (err) {
    if (err instanceof MpApiError && err.status === 404) {
      // Ex.: notificação de teste do painel com id fictício.
      return json({ received: true, ignored: "pagamento_nao_encontrado" });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mercadopago-webhook]", message);
    await connectLog(supabase, conn.store_id, "error", "Falha ao processar webhook do Mercado Pago", {
      payment_id: paymentId,
      error: message.slice(0, 500),
    }, conn.id, "error");
    // 500 → o Mercado Pago reenvia depois; o cron também cobre.
    return json({ error: "Falha ao processar notificação" }, 500);
  }
});
