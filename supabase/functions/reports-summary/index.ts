import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadDetailedReport } from "../_shared/detailed-report.ts";
import { validReportRange } from "../_shared/report-utils.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // Get profile
    const svc = createClient(SB_URL, SB_SERVICE);
    const { data: profile } = await svc
      .from("profiles")
      .select("id, store_id, role, is_active")
      .eq("auth_user_id", user.id)
      .single();

    if (!profile || !profile.is_active) return json({ error: "sem_permissao" }, 403);

    const storeId = profile.store_id;
    const url = new URL(req.url);
    const todayBR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const daysAgoBR = (n: number) => {
      const [y, m, d] = todayBR.split("-").map(Number);
      const a = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
      a.setUTCDate(a.getUTCDate() - n);
      return `${a.getUTCFullYear()}-${String(a.getUTCMonth() + 1).padStart(2, "0")}-${String(a.getUTCDate()).padStart(2, "0")}`;
    };
    const from = url.searchParams.get("from") || daysAgoBR(30);
    const to = url.searchParams.get("to") || todayBR;
    if (!validReportRange(from, to)) return json({ error: "periodo_invalido" }, 400);
    const report = await loadDetailedReport(svc, storeId, { from, to, seller: url.searchParams.get("seller") });
    return json({
      net_revenue: report.summary.net_revenue,
      amount_received: report.summary.amount_received,
      amount_pending: report.summary.amount_pending,
      gross_profit: report.summary.gross_profit,
      expense_total: report.summary.expense_total,
      low_stock: report.stock.low_stock,
      top_returns: report.returns.top_products.map(p => ({ sku: p.sku, returned_qty: p.qty })),
    }, 200);

  } catch (e) {
    console.error("reports-summary error:", e);
    return json({ error: "internal_error", message: "Erro interno. Tente novamente." }, 500);
  }
});

function json(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
