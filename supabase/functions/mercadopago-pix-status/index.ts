// Estokfy — Edge Function: mercadopago-pix-status
//
// Consulta o status de uma cobrança Pix direto no Mercado Pago e aplica no
// banco. A tela do Pix chama esta função enquanto espera o pagamento, então
// a venda é quitada mesmo se o aviso do webhook atrasar ou se perder.
//
// Body: { chargeId: uuid }   Auth: Authorization: Bearer <jwt do usuário>
// Env: MP_PIX_TEST_ACCESS_TOKEN (ou MP_PIX_ACCESS_TOKEN), MP_PIX_STORE_ID,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { MpApiError } from "../_shared/mercadopago.ts";
import { CORS, json, serviceClient } from "../_shared/mercadopago-server.ts";
import { pixAccessToken, syncPixOrder } from "../_shared/mercadopago-pix-server.ts";

// Mesmos papéis que podem quitar uma venda (settle_sale_payment).
const PIX_ROLES = ["owner", "admin", "manager", "sales", "finance"];
const FINAL_STATUSES = ["paid", "expired", "cancelled", "failed"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = pixAccessToken();
  if (!token) return json({ error: "Pix pelo Mercado Pago ainda não configurado" }, 503);

  const body = await req.json().catch(() => ({})) as { chargeId?: string };
  if (!body.chargeId) return json({ error: "chargeId obrigatório" }, 400);

  const supabase = serviceClient();

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: "Não autorizado" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("store_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!profile?.store_id) return json({ error: "Loja não encontrada" }, 403);
  if (!PIX_ROLES.includes(profile.role as string)) return json({ error: "Sem permissão" }, 403);

  const { data: charge } = await supabase
    .from("mercadopago_pix_charges")
    .select("id, store_id, status, mp_order_id")
    .eq("id", body.chargeId)
    .maybeSingle();
  if (!charge || charge.store_id !== profile.store_id) return json({ error: "Cobrança não encontrada" }, 404);

  if (FINAL_STATUSES.includes(charge.status as string) || !charge.mp_order_id) {
    return json({ chargeId: charge.id, status: charge.status });
  }

  try {
    const applied = await syncPixOrder(supabase, token, charge.mp_order_id as string, charge.id as string);
    const { data: fresh } = await supabase
      .from("mercadopago_pix_charges")
      .select("status")
      .eq("id", charge.id)
      .maybeSingle();
    return json({
      chargeId: charge.id,
      status: fresh?.status ?? charge.status,
      mpStatus: applied?.mpStatus ?? null,
      mpStatusDetail: applied?.mpStatusDetail ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mercadopago-pix-status]", message);
    const status = err instanceof MpApiError ? 502 : 500;
    return json({ chargeId: charge.id, status: charge.status, error: "Não foi possível consultar o Mercado Pago agora" }, status);
  }
});
