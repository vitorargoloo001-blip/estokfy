// Estokfy — Edge Function: mercadopago-pix-create
//
// Gera a cobrança Pix de uma venda: abre a cobrança no banco, cria a order
// no Mercado Pago (Orders API) e devolve QR Code e copia-e-cola.
//
// Body: { saleId: uuid }   Auth: Authorization: Bearer <jwt do usuário>
//       { probe: true } só responde se o Pix está disponível para este
//       usuário e loja ({ enabled: true }), sem abrir cobrança.
// Env: MP_PIX_ACCESS_TOKEN (produção) ou MP_PIX_TEST_ACCESS_TOKEN (teste),
//      MP_PIX_STORE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { MpApiError, MP_API } from "../_shared/mercadopago.ts";
import { CORS, json, serviceClient } from "../_shared/mercadopago-server.ts";
import { pixAccessToken } from "../_shared/mercadopago-pix-server.ts";
import {
  buildPixOrderPayload,
  parsePixOrderResponse,
  PIX_DEFAULT_TTL_MS,
  splitPayerName,
  type PixChargeRow,
  type PixOrderResponse,
} from "../_shared/mercadopago-pix.ts";

// Mesmos papéis que podem quitar uma venda (settle_sale_payment).
const PIX_ROLES = ["owner", "admin", "manager", "sales", "finance"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = pixAccessToken();
  const pixStore = Deno.env.get("MP_PIX_STORE_ID");
  if (!token || !pixStore) return json({ error: "Pix pelo Mercado Pago ainda não configurado" }, 503);

  const body = await req.json().catch(() => ({})) as { saleId?: string; probe?: boolean };
  if (!body.saleId && body.probe !== true) return json({ error: "saleId obrigatório" }, 400);

  const supabase = serviceClient();

  // 1. Usuário e loja
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: "Não autorizado" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, store_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!profile?.store_id) return json({ error: "Loja não encontrada" }, 403);
  if (!PIX_ROLES.includes(profile.role as string)) return json({ error: "Sem permissão para cobrar" }, 403);
  if (profile.store_id !== pixStore) return json({ error: "Pix ainda não habilitado para esta loja" }, 403);
  if (body.probe === true) return json({ enabled: true });

  // 2. Abre a cobrança (valida a venda e o saldo no banco)
  const { data: opened, error: openErr } = await supabase.rpc("mercadopago_pix_begin_charge", {
    p_store_id: profile.store_id,
    p_sale_id: body.saleId,
    p_actor_id: profile.id,
  });
  if (openErr) {
    const msg = openErr.message ?? "";
    const known = ["venda_nao_encontrada", "store_invalida", "venda_ja_quitada"];
    const reason = known.find((k) => msg.includes(k));
    return json({ error: reason ?? "Não foi possível abrir a cobrança" }, reason ? 409 : 500);
  }
  const charge = opened as unknown as PixChargeRow & { qr_code?: string; qr_code_base64?: string; ticket_url?: string; status: string };

  // Cobrança já existente e pronta: devolve sem chamar o Mercado Pago de novo.
  // Uma cobrança 'creating' pode ser recém-criada por esta chamada ou de uma
  // tentativa concorrente. Nos dois casos seguimos: a X-Idempotency-Key (id da
  // cobrança) faz o Mercado Pago devolver a mesma order, e o índice único do
  // banco impede duas cobranças abertas para a mesma venda.
  if (charge.status === "pending" && charge.qr_code && charge.qr_code_base64) {
    return json({ chargeId: charge.id, amount: charge.amount, status: "pending", qrCode: charge.qr_code, qrCodeBase64: charge.qr_code_base64, ticketUrl: charge.ticket_url ?? "" });
  }

  // 3. E-mail do pagador (obrigatório na Orders API)
  const { data: sale } = await supabase
    .from("sales")
    .select("customer_id")
    .eq("id", body.saleId)
    .maybeSingle();
  let payerEmail: string | null = null;
  let payerName: string | null = null;
  if (sale?.customer_id) {
    const { data: customer } = await supabase
      .from("customers")
      .select("email, name")
      .eq("id", sale.customer_id)
      .maybeSingle();
    payerEmail = customer?.email ?? null;
    payerName = customer?.name ?? null;
  }
  if (!payerEmail) {
    await supabase.rpc("mercadopago_pix_mark_failed", { p_charge_id: charge.id, p_error: "cliente_sem_email" });
    return json({ error: "Cadastre o e-mail do cliente para cobrar por Pix" }, 422);
  }

  // 4. Cria a order no Mercado Pago
  try {
    const res = await fetch(`${MP_API}/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": charge.id,
      },
      body: JSON.stringify(buildPixOrderPayload(charge, { email: payerEmail, ...splitPayerName(payerName) })),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (!res.ok) throw new MpApiError(res.status, `Mercado Pago POST /v1/orders (${res.status}): ${text.slice(0, 300)}`);
    const order = JSON.parse(text) as PixOrderResponse;
    const display = parsePixOrderResponse(order);
    const expiresAt = new Date(Date.now() + PIX_DEFAULT_TTL_MS).toISOString();

    const { error: attachErr } = await supabase.rpc("mercadopago_pix_attach", {
      p_charge_id: charge.id,
      p_order_id: display.orderId,
      p_payment_id: display.paymentId,
      p_qr_code: display.qrCode,
      p_qr_code_b64: display.qrCodeBase64,
      p_ticket_url: display.ticketUrl,
      p_expires_at: expiresAt,
    });
    if (attachErr) throw new Error(attachErr.message);

    return json({
      chargeId: charge.id,
      amount: charge.amount,
      status: "pending",
      qrCode: display.qrCode,
      qrCodeBase64: display.qrCodeBase64,
      ticketUrl: display.ticketUrl,
      expiresAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mercadopago-pix-create]", message);
    await supabase.rpc("mercadopago_pix_mark_failed", { p_charge_id: charge.id, p_error: message.slice(0, 500) });
    return json({ error: "Não foi possível gerar o Pix agora. Tente de novo." }, 502);
  }
});
