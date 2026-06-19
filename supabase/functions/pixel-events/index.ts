import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pixel-id, x-pixel-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_EVENTS = [
  "purchase_approved",
  "purchase_cancelled",
  "refund_created",
  "refund_completed",
  "exchange_created",
  "customer_created",
  "payment_approved",
  "payment_failed",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // 1. Validate pixel credentials
    const pixelId = req.headers.get("x-pixel-id");
    const pixelKey = req.headers.get("x-pixel-key");

    if (!pixelId || !pixelKey) {
      return json({ error: "invalid_pixel", message: "Missing pixel credentials" }, 401);
    }

    const { data: pixel, error: pixelErr } = await supabase
      .from("store_pixels")
      .select("id, store_id, pixel_id, secret_key, is_active, allowed_domains")
      .eq("pixel_id", pixelId)
      .single();

    if (pixelErr || !pixel) {
      return json({ error: "invalid_pixel", message: "Pixel not found" }, 401);
    }

    if (!pixel.is_active) {
      return json({ error: "pixel_inactive", message: "Pixel is inactive" }, 403);
    }

    if (pixel.secret_key !== pixelKey) {
      return json({ error: "invalid_signature", message: "Invalid secret key" }, 401);
    }

    // 2. Validate domain (optional)
    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    if (pixel.allowed_domains && pixel.allowed_domains.length > 0) {
      const originHost = (() => {
        try { return new URL(origin).hostname; } catch { return ""; }
      })();
      if (originHost && !pixel.allowed_domains.some((d: string) => originHost.endsWith(d))) {
        return json({ error: "domain_not_allowed", message: "Origin domain not authorized" }, 403);
      }
    }

    // 3. Parse body
    const body = await req.json();
    const { event_type, external_event_id, external_order_id, external_customer_id, payload } = body;

    if (!event_type || !VALID_EVENTS.includes(event_type)) {
      return json({ error: "invalid_event_type", message: `Supported: ${VALID_EVENTS.join(", ")}` }, 400);
    }

    // 4. Idempotency check
    if (external_event_id) {
      const { data: existing } = await supabase
        .from("pixel_events")
        .select("id, processing_status")
        .eq("store_id", pixel.store_id)
        .eq("external_event_id", external_event_id)
        .maybeSingle();

      if (existing) {
        return json({ status: "duplicate_event", event_id: existing.id, processing_status: existing.processing_status });
      }
    }

    // 5. Insert event
    const { data: evt, error: insertErr } = await supabase
      .from("pixel_events")
      .insert({
        store_id: pixel.store_id,
        pixel_id: pixel.pixel_id,
        event_type,
        external_event_id: external_event_id || null,
        external_order_id: external_order_id || null,
        external_customer_id: external_customer_id || null,
        payload_json: payload || {},
        processing_status: "pending",
      })
      .select("id")
      .single();

    if (insertErr) {
      return json({ error: "processing_error", message: insertErr.message }, 500);
    }

    // 6. Process event
    try {
      await processEvent(supabase, pixel.store_id, evt!.id, event_type, {
        external_order_id,
        external_customer_id,
        payload: payload || {},
      });

      await supabase
        .from("pixel_events")
        .update({ processing_status: "processed", processed_at: new Date().toISOString() })
        .eq("id", evt!.id);

      return json({ status: "success", event_id: evt!.id });
    } catch (procErr: any) {
      await supabase
        .from("pixel_events")
        .update({ processing_status: "error", error_message: procErr.message, processed_at: new Date().toISOString() })
        .eq("id", evt!.id);

      return json({ status: "processed_with_error", event_id: evt!.id, error: procErr.message });
    }
  } catch (err: any) {
    return json({ error: "processing_error", message: err.message }, 500);
  }
});

// ─── Event Processing ───────────────────────────────────────────────
async function processEvent(
  supabase: any,
  storeId: string,
  eventId: string,
  eventType: string,
  data: { external_order_id?: string; external_customer_id?: string; payload: any },
) {
  switch (eventType) {
    case "purchase_approved":
    case "payment_approved":
      return processPurchase(supabase, storeId, eventId, data);
    case "purchase_cancelled":
      return processCancellation(supabase, storeId, eventId, data);
    case "refund_created":
    case "refund_completed":
    case "exchange_created":
      return processRefund(supabase, storeId, eventId, eventType, data);
    case "customer_created":
      return processCustomerCreated(supabase, storeId, data);
    case "payment_failed":
      // Just log it, no action needed
      return;
  }
}

async function findOrCreateCustomer(supabase: any, storeId: string, customerData: any): Promise<string | null> {
  if (!customerData) return null;

  const { email, phone, doc_id, name, external_id } = customerData;

  // Try to find existing customer by email, phone, or doc_id
  let existing: any = null;

  if (email) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("store_id", storeId)
      .eq("email", email)
      .maybeSingle();
    existing = data;
  }

  if (!existing && phone) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("store_id", storeId)
      .eq("phone", phone)
      .maybeSingle();
    existing = data;
  }

  if (!existing && doc_id) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("store_id", storeId)
      .eq("doc_id", doc_id)
      .maybeSingle();
    existing = data;
  }

  if (existing) return existing.id;

  // Create new customer
  const { data: newCust, error } = await supabase
    .from("customers")
    .insert({
      store_id: storeId,
      name: name || email || "Cliente sem nome",
      email: email || null,
      phone: phone || null,
      doc_id: doc_id || null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`customer_create_failed: ${error.message}`);
  return newCust.id;
}

async function processPurchase(supabase: any, storeId: string, eventId: string, data: any) {
  const p = data.payload;
  const customerId = await findOrCreateCustomer(supabase, storeId, p.customer);

  // Check if order already exists
  if (data.external_order_id) {
    const { data: existingEvt } = await supabase
      .from("pixel_events")
      .select("sale_id")
      .eq("store_id", storeId)
      .eq("external_order_id", data.external_order_id)
      .eq("processing_status", "processed")
      .neq("id", eventId)
      .maybeSingle();

    if (existingEvt?.sale_id) {
      // Update event with existing sale reference
      await supabase.from("pixel_events").update({ sale_id: existingEvt.sale_id, customer_id: customerId }).eq("id", eventId);
      return;
    }
  }

  const totalAmount = Number(p.total_amount || 0);
  const discountTotal = Number(p.discount || 0);
  const shippingFee = Number(p.shipping_fee || 0);

  // Create sale
  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .insert({
      store_id: storeId,
      customer_id: customerId,
      status: "paid",
      gross_total: totalAmount,
      discount_total: discountTotal,
      shipping_fee: shippingFee,
      net_total: totalAmount - discountTotal + shippingFee,
      cost_total: 0,
      profit_gross: totalAmount - discountTotal,
      notes: `Pixel: ${data.external_order_id || "N/A"}`,
    })
    .select("id")
    .single();

  if (saleErr) throw new Error(`sale_create_failed: ${saleErr.message}`);

  // Create payment
  await supabase.from("payments").insert({
    store_id: storeId,
    sale_id: sale.id,
    method: p.payment_method || "other",
    amount: totalAmount,
  });

  // Link event to sale and customer
  await supabase.from("pixel_events").update({ sale_id: sale.id, customer_id: customerId }).eq("id", eventId);

  // Audit log
  await supabase.from("audit_logs").insert({
    store_id: storeId,
    action: "pixel_purchase",
    entity: "sale",
    entity_id: sale.id,
    after_json: { external_order_id: data.external_order_id, total: totalAmount },
  });
}

async function processCancellation(supabase: any, storeId: string, eventId: string, data: any) {
  if (!data.external_order_id) throw new Error("external_order_id required for cancellation");

  // Find original sale via pixel_events
  const { data: origEvt } = await supabase
    .from("pixel_events")
    .select("sale_id")
    .eq("store_id", storeId)
    .eq("external_order_id", data.external_order_id)
    .eq("processing_status", "processed")
    .not("sale_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (!origEvt?.sale_id) throw new Error("original_sale_not_found");

  await supabase.from("sales").update({ status: "cancelled" }).eq("id", origEvt.sale_id);
  await supabase.from("pixel_events").update({ sale_id: origEvt.sale_id }).eq("id", eventId);

  await supabase.from("audit_logs").insert({
    store_id: storeId,
    action: "pixel_cancellation",
    entity: "sale",
    entity_id: origEvt.sale_id,
    after_json: { external_order_id: data.external_order_id },
  });
}

async function processRefund(supabase: any, storeId: string, eventId: string, eventType: string, data: any) {
  if (!data.external_order_id) throw new Error("external_order_id required for refund");

  const { data: origEvt } = await supabase
    .from("pixel_events")
    .select("sale_id")
    .eq("store_id", storeId)
    .eq("external_order_id", data.external_order_id)
    .eq("processing_status", "processed")
    .not("sale_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (!origEvt?.sale_id) throw new Error("original_sale_not_found");

  const reason = eventType === "exchange_created" ? "customer_regret" : "defect";
  const status = eventType === "refund_completed" ? "approved" : "pending";

  const { data: ret, error: retErr } = await supabase
    .from("returns")
    .insert({
      store_id: storeId,
      sale_id: origEvt.sale_id,
      status,
      reason,
      notes: `Pixel: ${data.external_order_id}`,
    })
    .select("id")
    .single();

  if (retErr) throw new Error(`return_create_failed: ${retErr.message}`);

  await supabase.from("pixel_events").update({ sale_id: origEvt.sale_id, return_id: ret.id }).eq("id", eventId);

  await supabase.from("audit_logs").insert({
    store_id: storeId,
    action: `pixel_${eventType}`,
    entity: "return",
    entity_id: ret.id,
    after_json: { external_order_id: data.external_order_id, event_type: eventType },
  });
}

async function processCustomerCreated(supabase: any, storeId: string, data: any) {
  await findOrCreateCustomer(supabase, storeId, data.payload?.customer || data.payload);
}
