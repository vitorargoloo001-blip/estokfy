// Estokfy Connect — Edge Function: pluggy-config-status
// Só pra Super Admin: informa se as credenciais da Pluggy estão configuradas
// nas env vars da Edge Function, sem nunca expor os valores. Usado pra
// mostrar "Pluggy não configurada" em vez de deixar o erro técnico só
// aparecer quando uma loja tenta conectar um banco de verdade.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: isSuperAdmin } = await supabase.rpc("is_super_admin");
    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ error: "Somente Super Admin" }), {
        status: 403, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const configured =
      !!Deno.env.get("PLUGGY_CLIENT_ID") &&
      !!Deno.env.get("PLUGGY_CLIENT_SECRET");
    const webhookConfigured = !!Deno.env.get("PLUGGY_WEBHOOK_SECRET");

    return new Response(
      JSON.stringify({ configured, webhookConfigured }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[pluggy-config-status]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
