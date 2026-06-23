/**
 * Estokfy Finance REST API
 *
 * Endpoints:
 *   GET  /finance-api/cashflow?store_id=&period=month&start=&end=
 *   GET  /finance-api/dre?store_id=&month=&year=
 *   GET  /finance-api/goals?store_id=&month=&year=
 *   GET  /finance-api/accounts?store_id=&status=pending
 *   GET  /finance-api/dashboard?store_id=
 *
 * Auth: Bearer token (JWT from Supabase)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/finance-api\/?/, "") || "";
  const params = url.searchParams;

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return err("Unauthorized — Bearer token required", 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const storeId = params.get("store_id");
  if (!storeId) return err("store_id é obrigatório", 400);

  try {
    switch (path) {
      case "cashflow": {
        const period = params.get("period") ?? "month";
        const start  = params.get("start")  ?? null;
        const end    = params.get("end")    ?? null;
        const { data, error } = await supabase.rpc("get_professional_cashflow", {
          p_store_id: storeId,
          p_period: period,
          p_start: start,
          p_end: end,
        });
        if (error) return err(error.message, 400);
        return ok({ cashflow: data, store_id: storeId, period });
      }

      case "dre": {
        const month = params.get("month") ? Number(params.get("month")) : null;
        const year  = params.get("year")  ? Number(params.get("year"))  : null;
        const { data, error } = await supabase.rpc("get_dre_comparison", {
          p_store_id: storeId,
          p_month: month,
          p_year: year,
        });
        if (error) return err(error.message, 400);
        return ok({ dre: data, store_id: storeId });
      }

      case "goals": {
        const month = params.get("month") ? Number(params.get("month")) : null;
        const year  = params.get("year")  ? Number(params.get("year"))  : null;
        const { data, error } = await supabase.rpc("get_finance_goals_progress", {
          p_store_id: storeId,
          p_month: month,
          p_year: year,
        });
        if (error) return err(error.message, 400);
        return ok({ goals: data, store_id: storeId });
      }

      case "accounts": {
        const status = params.get("status") ?? "pending";
        const { data, error } = await supabase.rpc("get_payables_with_alerts", {
          p_store_id: storeId,
          p_status: status,
        });
        if (error) return err(error.message, 400);

        // Receivables
        const { data: ar, error: arErr } = await supabase
          .from("sales")
          .select("id, net_total, amount_pending, payment_status, due_date")
          .eq("store_id", storeId)
          .in("payment_status", ["pending", "partial"])
          .is("deleted_at", null)
          .order("due_date", { ascending: true })
          .limit(50);

        return ok({
          payables: data,
          receivables: ar ?? [],
          store_id: storeId,
        });
      }

      case "dashboard": {
        const { data, error } = await supabase.rpc("get_executive_finance_dashboard", {
          p_store_id: storeId,
        });
        if (error) return err(error.message, 400);
        return ok({ dashboard: data, store_id: storeId });
      }

      case "ar-risk": {
        const limit = params.get("limit") ? Number(params.get("limit")) : 20;
        const { data, error } = await supabase.rpc("get_ar_risk_analysis", {
          p_store_id: storeId,
          p_limit: limit,
        });
        if (error) return err(error.message, 400);
        return ok({ ar_risk: data, store_id: storeId });
      }

      default:
        return ok({
          message: "Estokfy Finance API",
          version: "1.0.0",
          endpoints: [
            "GET /finance-api/cashflow?store_id=&period=month",
            "GET /finance-api/dre?store_id=&month=&year=",
            "GET /finance-api/goals?store_id=&month=&year=",
            "GET /finance-api/accounts?store_id=&status=pending",
            "GET /finance-api/dashboard?store_id=",
            "GET /finance-api/ar-risk?store_id=&limit=20",
          ],
        });
    }
  } catch (e) {
    return err((e as Error).message, 500);
  }
});

function ok(body: unknown) {
  return new Response(JSON.stringify({ success: true, data: body, ts: new Date().toISOString() }), {
    status: 200,
    headers: CORS,
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: message }), { status, headers: CORS });
}
