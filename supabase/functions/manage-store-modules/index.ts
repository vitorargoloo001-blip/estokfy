import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

interface ModuleToggleRequest {
  action: "toggle" | "revoke_tokens" | "send_notification";
  store_id: string;
  module_key: string;
  is_active?: boolean;
  deactivation_delay_minutes?: number;
  notification_type?: "activation" | "deactivation" | "expiring_soon";
}

serve(async (req: Request) => {
  // Only POST allowed
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload: ModuleToggleRequest = await req.json();
    const { action, store_id, module_key } = payload;

    // Validate required fields
    if (!store_id || !module_key) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    switch (action) {
      case "toggle":
        return await toggleModule(payload);

      case "revoke_tokens":
        return await revokeModuleTokens(store_id, module_key);

      case "send_notification":
        return await sendModuleNotification(payload);

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("Error in manage-store-modules:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function toggleModule(payload: ModuleToggleRequest) {
  const { store_id, module_key, is_active, deactivation_delay_minutes } =
    payload;

  const { data, error } = await supabase.rpc("toggle_store_module", {
    p_store_id: store_id,
    p_module_key: module_key,
    p_is_active: is_active,
    p_deactivation_delay_minutes: deactivation_delay_minutes,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // If deactivating, immediately revoke tokens in background
  if (!is_active && module_key === "connect") {
    revokeModuleTokens(store_id, module_key).catch((err) =>
      console.error("Token revocation failed:", err)
    );

    sendModuleNotification({
      action: "send_notification",
      store_id,
      module_key,
      notification_type: "deactivation",
    }).catch((err) => console.error("Notification failed:", err));
  }

  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function revokeModuleTokens(store_id: string, module_key: string) {
  if (module_key !== "connect") {
    return new Response(
      JSON.stringify({ message: "No tokens to revoke for this module" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const { error } = await supabase
    .from("connect_oauth_tokens")
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
    })
    .eq("store_id", store_id)
    .eq("is_active", true);

  if (error) {
    console.error("Token revocation error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to revoke tokens" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`Revoked all active Connect tokens for store: ${store_id}`);

  return new Response(
    JSON.stringify({ success: true, message: "Tokens revoked" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

async function sendModuleNotification(payload: ModuleToggleRequest) {
  const { store_id, module_key, notification_type } = payload;

  const { data: store } = await supabase
    .from("stores")
    .select("business_name, owner_id")
    .eq("id", store_id)
    .single();

  if (!store) {
    return new Response(JSON.stringify({ error: "Store not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", store.owner_id)
    .single();

  if (!profile?.email) {
    return new Response(
      JSON.stringify({ error: "Owner email not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  let subject = "";
  let html = "";

  switch (notification_type) {
    case "activation":
      subject = "Estokfy Connect Ativado";
      html = `
        <h2>Bem-vindo ao Estokfy Connect!</h2>
        <p>O módulo <strong>Estokfy Connect</strong> foi ativado para sua loja.</p>
        <p>Agora você pode:</p>
        <ul>
          <li>Conectar suas contas bancárias</li>
          <li>Sincronizar transações automaticamente</li>
          <li>Reconciliar vendas com pagamentos</li>
        </ul>
        <p><a href="https://estokfy.pages.dev/connect">Acessar Estokfy Connect</a></p>
      `;
      break;

    case "deactivation":
      subject = "Estokfy Connect Desativado";
      html = `
        <h2>Estokfy Connect Desativado</h2>
        <p>O módulo <strong>Estokfy Connect</strong> foi desativado para sua loja.</p>
        <p>Seus dados foram mantidos e podem ser recuperados se reativar o módulo.</p>
        <p>Para reativar, entre em contato com o suporte.</p>
      `;
      break;

    case "expiring_soon":
      subject = "Estokfy Connect Expirando em Breve";
      html = `
        <h2>Atenção: Licença Expirando</h2>
        <p>Sua licença de <strong>Estokfy Connect</strong> expira em 7 dias.</p>
        <p>Renove agora para continuar usando o módulo sem interrupção.</p>
      `;
      break;

    default:
      return new Response(
        JSON.stringify({ error: "Unknown notification type" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
  }

  console.log(`Notification queued: ${subject} to ${profile.email}`);

  return new Response(
    JSON.stringify({ success: true, message: "Notification queued" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
