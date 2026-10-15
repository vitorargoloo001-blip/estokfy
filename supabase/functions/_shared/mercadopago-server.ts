// Estokfy Connect — Mercado Pago: helpers de servidor (Deno) compartilhados
// por mercadopago-connect, mercadopago-sync-payments e mercadopago-webhook.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MP_PROVIDER, normalizeMpPayment, type MpPayment } from "./mercadopago.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

// Mesmos papéis de can_manage_connect (20260618000000_capabilities_system.sql).
export const CONNECT_MANAGER_ROLES = ["owner", "admin", "manager", "finance"];
// Criar/alterar conexão bancária segue a policy users_manage_own_connections.
export const CONNECTION_ADMIN_ROLES = ["owner", "admin", "manager"];

export interface ConnectCaller {
  userId: string;
  profileId: string;
  storeId: string;
  role: string;
}

export async function isConnectModuleActive(supabase: SupabaseClient, storeId: string): Promise<boolean> {
  const { data } = await supabase
    .from("store_modules")
    .select("is_active")
    .eq("store_id", storeId)
    .eq("module_key", "connect")
    .maybeSingle();
  return data?.is_active === true;
}

/** Valida JWT → profile → papel → licença Connect. Devolve Response em caso de recusa. */
export async function authorizeConnectCaller(
  supabase: SupabaseClient,
  req: Request,
  allowedRoles: string[],
): Promise<ConnectCaller | Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Não autorizado" }, 401);

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: "Não autorizado" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, store_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!profile?.store_id) return json({ error: "Loja não encontrada" }, 403);
  if (!allowedRoles.includes(profile.role as string)) {
    return json({ error: "Sem permissão para gerenciar o Estokfy Connect" }, 403);
  }
  if (!(await isConnectModuleActive(supabase, profile.store_id as string))) {
    return json({ error: "Módulo Connect inativo para esta loja" }, 403);
  }

  return {
    userId: user.id,
    profileId: profile.id as string,
    storeId: profile.store_id as string,
    role: profile.role as string,
  };
}

export interface MpConnection {
  id: string;
  store_id: string;
  provider_connection_id: string;
  connected_at: string | null;
  metadata: Record<string, unknown> | null;
}

export const MP_CONNECTION_COLUMNS = "id, store_id, provider_connection_id, connected_at, metadata";

/**
 * V1: uma única credencial (Access Token da aplicação "Estokfy Connect",
 * conta Mercado Pago da Dibacell) guardada nos secrets do Supabase e
 * amarrada a UMA loja por MP_V1_STORE_ID. Na fase 2 (OAuth por loja) só
 * esta função muda: passa a ler o token da própria conexão.
 */
export function getAccessToken(conn: { store_id: string }): string {
  const token = Deno.env.get("MP_ACCESS_TOKEN");
  const v1Store = Deno.env.get("MP_V1_STORE_ID");
  if (!token || !v1Store) throw new Error("Credenciais do Mercado Pago não configuradas");
  if (conn.store_id !== v1Store) throw new Error("Conexão Mercado Pago sem credencial para esta loja");
  return token;
}

export interface IngestResult {
  action: string;
  isNew: boolean;
  matchable: boolean;
}

/** Normaliza e grava (idempotente) um pagamento já lido da API oficial. */
export async function ingestPayment(
  supabase: SupabaseClient,
  conn: MpConnection,
  payment: MpPayment,
): Promise<IngestResult> {
  const tx = normalizeMpPayment(payment, conn.provider_connection_id);
  if (!tx) return { action: "skipped_not_received", isNew: false, matchable: false };

  const { data, error } = await supabase.rpc("upsert_bank_transaction_mercadopago", {
    p_store_id: conn.store_id,
    p_bank_connection_id: conn.id,
    p_tx: tx,
  });
  if (error) throw new Error(`upsert_bank_transaction_mercadopago: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { action?: string; is_new?: boolean; became_matchable?: boolean }
    | null;
  return {
    action: row?.action ?? "unknown",
    isNew: row?.is_new === true,
    matchable: row?.became_matchable === true,
  };
}

/** Motor de conciliação existente, sem alteração (service_role). */
export async function runMatching(supabase: SupabaseClient, storeId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("_connect_run_matching_core", { p_store_id: storeId });
  if (error) throw new Error(`_connect_run_matching_core: ${error.message}`);
  return data;
}

export async function connectLog(
  supabase: SupabaseClient,
  storeId: string,
  logType: "sync" | "webhook" | "error" | "info" | "match",
  message: string,
  details: Record<string, unknown>,
  bankConnectionId: string | null,
  severity: "info" | "warning" | "error" = "info",
): Promise<void> {
  const { error } = await supabase.rpc("add_connect_log", {
    p_store_id: storeId,
    p_log_type: logType,
    p_message: message,
    p_details: details,
    p_bank_connection_id: bankConnectionId,
    p_severity: severity,
  });
  if (error) console.error("[mercadopago] add_connect_log falhou:", error.message);
}

export async function findActiveConnectionByMpUser(
  supabase: SupabaseClient,
  mpUserId: string,
): Promise<MpConnection | null> {
  const { data } = await supabase
    .from("bank_connections")
    .select(MP_CONNECTION_COLUMNS)
    .eq("provider", MP_PROVIDER)
    .eq("provider_connection_id", mpUserId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as MpConnection | null) ?? null;
}
