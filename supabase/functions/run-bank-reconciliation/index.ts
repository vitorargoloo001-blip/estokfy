import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

interface ReconciliationRequest {
  store_id: string;
  bank_connection_id?: string;
  user_id?: string;
}

interface Transaction {
  id: string;
  amount: number;
  date: string;
  description: string;
}

interface Sale {
  id: string;
  amount: number;
  date: string;
  customer_name: string;
}

interface MatchResult {
  transaction_id: string;
  sale_id: string | null;
  confidence_score: number;
  match_type: string;
  amount_difference: number | null;
  date_difference_days: number | null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const payload: ReconciliationRequest = await req.json();
    const { store_id, bank_connection_id, user_id } = payload;

    if (!store_id) {
      return new Response(
        JSON.stringify({ error: "Missing store_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch pending transactions
    const { data: transactions, error: txError } = await supabase
      .from("bank_transactions")
      .select("id, amount, transaction_date, description")
      .eq("store_id", store_id)
      .eq("status", "pending")
      .gt("transaction_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

    if (txError) {
      console.error("Error fetching transactions:", txError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch transactions" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch open sales for matching
    const { data: sales, error: salesError } = await supabase
      .from("sales")
      .select("id, total_amount, sale_date, customer_id")
      .eq("store_id", store_id)
      .eq("status", "completed")
      .gt("sale_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

    if (salesError) {
      console.error("Error fetching sales:", salesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch sales" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get customer names for matching
    const { data: customers } = await supabase.from("customers").select("id, name");
    const customerMap = new Map(customers?.map((c: any) => [c.id, c.name]) || []);

    const matches: MatchResult[] = [];

    for (const tx of transactions || []) {
      // PASS 1: Deterministic (score 100)
      let bestMatch = tryDeterministicMatch(tx, sales || []);

      // PASS 2: Heuristic (score 70-95)
      if (!bestMatch) {
        bestMatch = tryHeuristicMatch(tx, sales || [], customerMap);
      }

      // PASS 3: Fuzzy (score 50-70)
      if (!bestMatch) {
        bestMatch = tryFuzzyMatch(tx, sales || []);
      }

      if (bestMatch) {
        matches.push(bestMatch);
      } else {
        // No match found - create unmatched entry
        matches.push({
          transaction_id: tx.id,
          sale_id: null,
          confidence_score: 0,
          match_type: "unmatched",
          amount_difference: null,
          date_difference_days: null,
        });
      }
    }

    // Save all matches and auto-reconcile high confidence ones
    let autoReconciled = 0;
    let pendingReview = 0;

    for (const match of matches) {
      if (match.confidence_score >= 90 && match.sale_id) {
        // Auto-reconcile high confidence matches
        await supabase.from("reconciliation_matches").insert({
          bank_transaction_id: match.transaction_id,
          suggested_sale_id: match.sale_id,
          confidence_score: match.confidence_score,
          match_type: match.match_type,
          amount_difference: match.amount_difference,
          date_difference_days: match.date_difference_days,
          status: "confirmed",
        });

        // Update transaction status
        await supabase
          .from("bank_transactions")
          .update({ status: "reconciled" })
          .eq("id", match.transaction_id);

        autoReconciled++;
      } else if (match.confidence_score >= 60 && match.sale_id) {
        // Pending review for medium confidence
        await supabase.from("reconciliation_matches").insert({
          bank_transaction_id: match.transaction_id,
          suggested_sale_id: match.sale_id,
          confidence_score: match.confidence_score,
          match_type: match.match_type,
          amount_difference: match.amount_difference,
          date_difference_days: match.date_difference_days,
          status: "pending",
        });

        // Update transaction status
        await supabase
          .from("bank_transactions")
          .update({ status: "pending" })
          .eq("id", match.transaction_id);

        pendingReview++;
      } else {
        // Low or no match
        await supabase.from("reconciliation_matches").insert({
          bank_transaction_id: match.transaction_id,
          suggested_sale_id: null,
          confidence_score: match.confidence_score,
          match_type: "unmatched",
          status: "unmatched",
        });

        // Update transaction status
        await supabase
          .from("bank_transactions")
          .update({ status: "pending" })
          .eq("id", match.transaction_id);
      }
    }

    // Log auditoria
    if (user_id) {
      await supabase.rpc("log_connect_audit", {
        p_store_id: store_id,
        p_user_id: user_id,
        p_action: `Reconciliação executada: ${autoReconciled} auto-conciliadas, ${pendingReview} para revisão`,
        p_action_type: "reconciliation",
        p_entity_type: "reconciliation",
        p_details: {
          auto_reconciled: autoReconciled,
          pending_review: pendingReview,
          total_matches: matches.length,
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        auto_reconciled: autoReconciled,
        pending_review: pendingReview,
        total_processed: matches.length,
        message: `Reconciliação concluída: ${autoReconciled} conciliadas, ${pendingReview} para revisão, ${matches.length - autoReconciled - pendingReview} não identificadas`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in run-bank-reconciliation:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// PASS 1: Deterministic matching (score 100)
function tryDeterministicMatch(tx: Transaction, sales: any[]): MatchResult | null {
  const txDate = new Date(tx.date).toDateString();

  for (const sale of sales) {
    const saleDate = new Date(sale.sale_date).toDateString();

    // Exact match: same amount, same date
    if (
      Math.abs(tx.amount - sale.total_amount) < 0.01 &&
      txDate === saleDate
    ) {
      return {
        transaction_id: tx.id,
        sale_id: sale.id,
        confidence_score: 100,
        match_type: "deterministic",
        amount_difference: 0,
        date_difference_days: 0,
      };
    }
  }

  return null;
}

// PASS 2: Heuristic matching (score 70-95)
function tryHeuristicMatch(
  tx: Transaction,
  sales: any[],
  customerMap: Map<string, string>
): MatchResult | null {
  let bestMatch: MatchResult | null = null;
  let bestScore = 60;

  for (const sale of sales) {
    const txDate = new Date(tx.date);
    const saleDate = new Date(sale.sale_date);
    const dateDiff = Math.abs(txDate.getTime() - saleDate.getTime()) / (24 * 60 * 60 * 1000);

    // Check if date is within 2 days
    if (dateDiff > 2) continue;

    // Check if amount is within 1%
    const amountDiff = Math.abs(tx.amount - sale.total_amount);
    const percentDiff = (amountDiff / sale.total_amount) * 100;

    if (percentDiff > 1) continue;

    // Check if customer name is in description
    const customerName = customerMap.get(sale.customer_id) || "";
    const descLower = tx.description.toLowerCase();
    const hasCustomerName = descLower.includes(customerName.toLowerCase());

    // Calculate score
    let score = 75;
    score += (1 - percentDiff) * 10; // Up to 10 points for exact amount
    score += (1 - dateDiff / 2) * 10; // Up to 10 points for same day
    if (hasCustomerName) score += 5; // 5 points for customer name match

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        transaction_id: tx.id,
        sale_id: sale.id,
        confidence_score: Math.min(95, Math.round(score)),
        match_type: "heuristic",
        amount_difference: amountDiff,
        date_difference_days: Math.round(dateDiff),
      };
    }
  }

  return bestMatch;
}

// PASS 3: Fuzzy matching (score 50-70)
function tryFuzzyMatch(
  tx: Transaction,
  sales: any[]
): MatchResult | null {
  let bestMatch: MatchResult | null = null;
  let bestScore = 50;

  const txDate = new Date(tx.date);

  for (const sale of sales) {
    const saleDate = new Date(sale.sale_date);
    const dateDiff = Math.abs(txDate.getTime() - saleDate.getTime()) / (24 * 60 * 60 * 1000);

    // Check if date is within 7 days
    if (dateDiff > 7) continue;

    // Check if amount is similar (within 5%)
    const amountDiff = Math.abs(tx.amount - sale.total_amount);
    const percentDiff = (amountDiff / sale.total_amount) * 100;

    if (percentDiff > 5) continue;

    // Calculate score
    let score = 60;
    score += (1 - percentDiff / 5) * 5; // Up to 5 points
    score += (1 - dateDiff / 7) * 5; // Up to 5 points

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        transaction_id: tx.id,
        sale_id: sale.id,
        confidence_score: Math.round(score),
        match_type: "fuzzy",
        amount_difference: amountDiff,
        date_difference_days: Math.round(dateDiff),
      };
    }
  }

  return bestMatch;
}
