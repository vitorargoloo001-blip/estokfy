import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

interface AuditLogRequest {
  store_id: string;
  user_id: string;
  action: string;
  action_type: "login" | "sync" | "reconciliation" | "update" | "delete" | "reprocess";
  entity_type: string;
  entity_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload: AuditLogRequest = await req.json();
    const { store_id, user_id, action, action_type, entity_type } = payload;

    if (!store_id || !user_id || !action || !action_type || !entity_type) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data, error } = await supabase.rpc("log_connect_audit", {
      p_store_id: store_id,
      p_user_id: user_id,
      p_action: action,
      p_action_type: action_type,
      p_entity_type: entity_type,
      p_entity_id: payload.entity_id || null,
      p_details: payload.details || null,
      p_ip_address: payload.ip_address || null,
      p_user_agent: payload.user_agent || null,
    });

    if (error) {
      console.error("Error logging audit:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, audit_id: data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in log-connect-audit:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
