// Estokfy Connect — Edge Function: send-alert-email
// Envia alertas por email via Resend API
// Deploy: supabase functions deploy send-alert-email
// Env vars: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AlertPayload {
  store_id: string;
  alert_type: "divergent_transaction" | "low_reconciliation_rate" | "duplicate_payment" | "pending_too_long";
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  entity_id?: string;
  amount?: number;
}

const ALERT_COLORS: Record<string, string> = {
  error:   "#dc2626",
  warning: "#d97706",
  info:    "#2563eb",
};

const ALERT_EMOJI: Record<string, string> = {
  error:   "🚨",
  warning: "⚠️",
  info:    "ℹ️",
};

function buildEmailHTML(alert: AlertPayload, storeName: string): string {
  const color  = ALERT_COLORS[alert.severity] ?? "#2563eb";
  const emoji  = ALERT_EMOJI[alert.severity] ?? "📢";
  const amount = alert.amount
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(alert.amount)
    : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${alert.title}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <!-- Header -->
        <tr><td style="background:${color};padding:24px 32px;">
          <p style="margin:0;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Estokfy Connect</p>
          <h1 style="margin:8px 0 0;color:#fff;font-size:20px;">${emoji} ${alert.title}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${alert.message}</p>
          ${amount ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Valor</p>
            <p style="margin:4px 0 0;color:#111827;font-size:24px;font-weight:700;">${amount}</p>
          </div>` : ""}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr>
              <td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;">
                <p style="margin:0;color:#6b7280;font-size:12px;">Loja</p>
                <p style="margin:2px 0 0;color:#111827;font-size:14px;font-weight:600;">${storeName}</p>
              </td>
              <td width="16"></td>
              <td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 16px;">
                <p style="margin:0;color:#6b7280;font-size:12px;">Data/Hora</p>
                <p style="margin:2px 0 0;color:#111827;font-size:14px;font-weight:600;">${new Date().toLocaleString("pt-BR")}</p>
              </td>
            </tr>
          </table>
          <a href="https://estokfy.surge.sh/connect/divergencias"
             style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">
            Verificar no Estokfy →
          </a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            Estokfy Connect · Você recebe este email porque configurou alertas para esta loja.<br>
            Para desativar, acesse Configurações → Alertas por Email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY não configurada. Configure em Supabase → Edge Functions → Env vars." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const alert: AlertPayload = await req.json();

    // Buscar configurações de email da loja
    const { data: settings } = await supabase
      .from("email_alert_settings")
      .select("*")
      .eq("store_id", alert.store_id)
      .single();

    if (!settings?.is_enabled || !settings?.email_to) {
      return new Response(
        JSON.stringify({ sent: false, reason: "Alertas por email desativados para esta loja" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar se este tipo de alerta está ativado
    const typeEnabled: Record<string, boolean> = {
      divergent_transaction:  settings.on_divergent,
      low_reconciliation_rate: settings.on_low_rate,
      duplicate_payment:       settings.on_duplicate,
      pending_too_long:        settings.on_pending,
    };
    if (!typeEnabled[alert.alert_type]) {
      return new Response(
        JSON.stringify({ sent: false, reason: `Tipo de alerta '${alert.alert_type}' desativado` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Nome da loja
    const { data: store } = await supabase
      .from("stores")
      .select("name")
      .eq("id", alert.store_id)
      .single();

    const storeName = store?.name ?? "Sua loja";
    const html = buildEmailHTML(alert, storeName);

    // Enviar via Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Estokfy Connect <alertas@estokfy.com.br>",
        to: [settings.email_to],
        subject: `${ALERT_EMOJI[alert.severity] ?? "📢"} ${alert.title} — Estokfy Connect`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error("Resend error:", err);
      return new Response(
        JSON.stringify({ sent: false, error: err }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendData = await emailRes.json();
    console.log("Email enviado:", resendData.id);

    return new Response(
      JSON.stringify({ sent: true, id: resendData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
