// Estokfy — Edge Function: mercadopago-pix-webhook
//
// Recebe o aviso do Mercado Pago sobre a order Pix. Valida a assinatura,
// relê a order na API (o aviso é só um aviso) e aplica o status no banco.
// Quitação idempotente: aviso repetido não registra pagamento duplicado.
//
// Deploy com --no-verify-jwt (o Mercado Pago não manda JWT do Supabase).
// Env: MP_PIX_WEBHOOK_SECRET, MP_PIX_TEST_ACCESS_TOKEN (ou MP_PIX_ACCESS_TOKEN),
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { mpFetch, MpApiError, verifyMpSignature } from "../_shared/mercadopago.ts";
import { CORS, json, serviceClient } from "../_shared/mercadopago-server.ts";
import { pixAccessToken, syncPixOrder } from "../_shared/mercadopago-pix-server.ts";

const ORDER_TOPICS = ["order", "orders", "orders_v2"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const dataIdFromQuery = url.searchParams.get("data.id");

  // trim: secret colado no painel costuma vir com espaço/quebra de linha.
  const secret = (Deno.env.get("MP_PIX_WEBHOOK_SECRET") ?? "").trim();
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  const valid = await verifyMpSignature({ xSignature, xRequestId, dataId: dataIdFromQuery, secret });
  if (!valid) {
    // Diagnóstico sem expor segredo nem a assinatura recebida.
    console.warn(
      `[mercadopago-pix-webhook] assinatura inválida — rejeitado ` +
      `(data.id=${dataIdFromQuery ?? "-"} query=${[...url.searchParams.keys()].join(",")} ` +
      `x-request-id=${xRequestId ? "sim" : "nao"} x-signature=${xSignature ? "sim" : "nao"} secret_len=${secret.length})`,
    );
    return json({ error: "Assinatura inválida" }, 401);
  }

  let body: { type?: string; topic?: string; action?: string; data?: { id?: string | number } };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const topic = body.type ?? body.topic ?? "";
  console.log(`[mercadopago-pix-webhook] aviso recebido: topic=${topic} action=${body.action ?? "-"} data.id=${dataIdFromQuery}`);
  if (!ORDER_TOPICS.includes(topic) && topic !== "payment") {
    return json({ received: true, ignored: "topico_nao_tratado", topic });
  }
  const dataId = body.data?.id != null ? String(body.data.id) : "";
  if (!dataId || !dataIdFromQuery || dataIdFromQuery.toLowerCase() !== dataId.toLowerCase()) {
    return json({ error: "data.id ausente ou inconsistente" }, 400);
  }

  const token = pixAccessToken();
  if (!token) return json({ error: "Pix não configurado" }, 503);

  try {
    // Aviso de pagamento: descobre a order a partir do pagamento.
    let orderId = dataId;
    if (topic === "payment") {
      const payment = await mpFetch<{ order?: { id?: string | number } | null }>(
        `/v1/payments/${encodeURIComponent(dataId)}`, token, { retries: 1, timeoutMs: 7000 },
      );
      if (!payment.order?.id) return json({ received: true, ignored: "pagamento_sem_order" });
      orderId = String(payment.order.id);
    }

    const applied = await syncPixOrder(serviceClient(), token, orderId);
    if (!applied) return json({ received: true, ignored: "order_sem_referencia" });
    console.log(`[mercadopago-pix-webhook] order=${orderId} status=${applied.status} mp=${applied.mpStatus}/${applied.mpStatusDetail}`);
    return json({ received: true, status: applied.status, result: applied.result });
  } catch (err) {
    if (err instanceof MpApiError && err.status === 404) {
      return json({ received: true, ignored: "order_nao_encontrada" });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mercadopago-pix-webhook]", message);
    // 500 faz o Mercado Pago reenviar o aviso depois.
    return json({ error: "Falha ao processar o aviso" }, 500);
  }
});
