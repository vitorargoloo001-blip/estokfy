// Estokfy Connect — Edge Function: mercadopago-connect
//
// Liga a conta Mercado Pago da V1 à loja do usuário. Testa a credencial
// com GET /users/me (descobre o user_id da conta, usado para rotear o
// webhook) e grava/reativa a linha em bank_connections via
// upsert_mercadopago_connection. Não importa histórico: o cursor de
// sincronização começa no momento da conexão.
//
// Body: {} — a loja vem do JWT do usuário.
// Env: MP_ACCESS_TOKEN, MP_V1_STORE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { mpFetch, MpApiError } from "../_shared/mercadopago.ts";
import {
  authorizeConnectCaller,
  CONNECTION_ADMIN_ROLES,
  connectLog,
  CORS,
  json,
  serviceClient,
} from "../_shared/mercadopago-server.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabase = serviceClient();
    const caller = await authorizeConnectCaller(supabase, req, CONNECTION_ADMIN_ROLES);
    if (caller instanceof Response) return caller;

    const token = Deno.env.get("MP_ACCESS_TOKEN");
    const v1Store = Deno.env.get("MP_V1_STORE_ID");
    if (!token || !v1Store) {
      return json({ error: "Integração Mercado Pago ainda não configurada" }, 503);
    }
    if (caller.storeId !== v1Store) {
      return json({ error: "Conexão Mercado Pago ainda não disponível para esta loja" }, 403);
    }

    type MpUser = { id: number | string; nickname?: string | null; site_id?: string | null };
    let me: MpUser;
    try {
      me = await mpFetch<MpUser>("/users/me", token, { retries: 1 });
    } catch (err) {
      const status = err instanceof MpApiError ? err.status : 0;
      console.error("[mercadopago-connect] /users/me falhou:", String(err));
      return json({
        error: status === 401 || status === 403
          ? "Credencial do Mercado Pago recusada — confira o Access Token configurado"
          : "Não foi possível falar com o Mercado Pago agora. Tente de novo em instantes.",
      }, 502);
    }

    const { data: connectionId, error } = await supabase.rpc("upsert_mercadopago_connection", {
      p_store_id: caller.storeId,
      p_mp_user_id: String(me.id),
      p_nickname: me.nickname ?? null,
      p_site_id: me.site_id ?? null,
      p_created_by: caller.profileId,
    });

    if (error) {
      if (error.message.includes("conta_mp_ja_conectada_em_outra_loja")) {
        return json({ error: "Esta conta Mercado Pago já está conectada a outra loja" }, 409);
      }
      throw new Error(error.message);
    }

    await connectLog(supabase, caller.storeId, "info", "Mercado Pago conectado", {
      nickname: me.nickname ?? null,
      site_id: me.site_id ?? null,
    }, connectionId as string);

    return json({ success: true, connectionId, nickname: me.nickname ?? null });
  } catch (err) {
    console.error("[mercadopago-connect]", err);
    return json({ error: "Erro ao conectar o Mercado Pago" }, 500);
  }
});
