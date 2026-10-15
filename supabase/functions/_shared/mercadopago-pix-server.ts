// Estokfy — Pix Mercado Pago: helpers de servidor (Deno) compartilhados por
// mercadopago-pix-webhook e mercadopago-pix-status.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mpFetch } from "./mercadopago.ts";
import { mapPixOrderStatus, paidAmountOf, type PixOrderResponse, type PixStatus } from "./mercadopago-pix.ts";

// Produção primeiro: quando MP_PIX_ACCESS_TOKEN existir, ele é o que vale.
// MP_PIX_TEST_ACCESS_TOKEN só é usado se o de produção não estiver configurado.
export function pixAccessToken(): string | null {
  return Deno.env.get("MP_PIX_ACCESS_TOKEN") ?? Deno.env.get("MP_PIX_TEST_ACCESS_TOKEN") ?? null;
}

export interface ApplyOrderResult {
  status: PixStatus;
  mpStatus: string | null;
  mpStatusDetail: string | null;
  result: unknown;
}

/**
 * Relê a order no Mercado Pago (fonte da verdade) e aplica o status na
 * cobrança. Idempotente: chamar várias vezes para uma order paga não duplica
 * o pagamento (mercadopago_pix_apply_status trata isso no banco).
 */
export async function syncPixOrder(
  supabase: SupabaseClient,
  token: string,
  orderId: string,
  expectedChargeId?: string,
): Promise<ApplyOrderResult | null> {
  const order = await mpFetch<PixOrderResponse>(`/v1/orders/${encodeURIComponent(orderId)}`, token, {
    retries: 1,
    timeoutMs: 7000,
  });

  const chargeId = order.external_reference ?? "";
  if (!chargeId) return null;
  if (expectedChargeId && chargeId !== expectedChargeId) {
    throw new Error("order_de_outra_cobranca");
  }

  const status = mapPixOrderStatus(order.status, order.status_detail);
  const payment = order.transactions?.payments?.[0];
  const paymentId = payment?.id != null ? String(payment.id) : orderId;
  const paidAmount = status === "paid" ? paidAmountOf(order) : null;
  const paidAt = payment?.date_last_updated ?? order.last_updated_date ?? new Date().toISOString();

  const { data, error } = await supabase.rpc("mercadopago_pix_apply_status", {
    p_charge_id: chargeId,
    p_status: status,
    p_payment_id: paymentId,
    p_paid_amount: paidAmount,
    p_paid_at: paidAt,
  });
  if (error) throw new Error(error.message);

  return { status, mpStatus: order.status ?? null, mpStatusDetail: order.status_detail ?? null, result: data };
}
