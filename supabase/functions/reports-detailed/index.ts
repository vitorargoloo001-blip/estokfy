// Aggregated detailed report: summary, sales, returns, stock, finance, timeline
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { loadDetailedReport } from "../_shared/detailed-report.ts";
import { reportDay, validReportRange } from "../_shared/report-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const num = (v: unknown) => Number(v ?? 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing_token" }, 401);

    const userClient = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "missing_token" }, 401);

    const svc = createClient(SB_URL, SB_SERVICE);
    const { data: profile } = await svc
      .from("profiles")
      .select("id, store_id, role, is_active")
      .eq("auth_user_id", user.id)
      .single();
    if (!profile?.is_active) return json({ error: "sem_permissao" }, 403);

    const storeId = profile.store_id;
    const url = new URL(req.url);
    const today = reportDay(new Date());
    const from = url.searchParams.get("from") || today;
    const to = url.searchParams.get("to") || today;
    const compareFrom = url.searchParams.get("compare_from");
    const compareTo = url.searchParams.get("compare_to");
    if (!validReportRange(from, to) || ((compareFrom || compareTo) && (!compareFrom || !compareTo || !validReportRange(compareFrom, compareTo)))) {
      return json({ error: "periodo_invalido", message: "Informe um período válido, com início anterior ou igual ao fim." }, 400);
    }
    return json(await loadDetailedReport(svc, storeId, { from, to, compareFrom, compareTo, seller: url.searchParams.get("seller") }));

  } catch (e) {
    console.error("reports-detailed error:", e);
    return json({ error: "internal_error", message: "Erro interno." }, 500);
  }
});
