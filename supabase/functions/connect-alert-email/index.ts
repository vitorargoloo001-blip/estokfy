import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonRes({ error: "method_not_allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const {
      store_id,
      alert_type,
      title,
      message,
      recipient_email,
      data,
    } = (await req.json()) as Record<string, unknown>;

    if (!store_id || !alert_type || !title || !message || !recipient_email) {
      return jsonRes({ error: "missing_fields" }, 400);
    }

    // Tipos de alertas
    const alertTypes: Record<string, string> = {
      reconciliation_failed: "Falha na Conciliação",
      discrepancy_detected: "Divergência Detectada",
      webhook_error: "Erro em Webhook",
      sync_error: "Erro na Sincronização",
      unmatched_transactions: "Transações Não Conciliadas",
    };

    const alertTitle = alertTypes[alert_type as string] || alert_type;

    // Construir email HTML
    const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #3b82f6; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
            .message { margin: 15px 0; }
            .footer { background-color: #f3f4f6; padding: 15px; border-radius: 0 0 8px 8px; font-size: 12px; color: #666; }
            .alert-badge {
              display: inline-block;
              background-color: #ef4444;
              color: white;
              padding: 4px 12px;
              border-radius: 4px;
              font-size: 12px;
              font-weight: bold;
              margin-bottom: 15px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔔 ${alertTitle}</h1>
            </div>
            <div class="content">
              <div class="alert-badge">${alertTitle.toUpperCase()}</div>
              <div class="message">
                <h2>${title}</h2>
                <p>${message}</p>
              </div>
              ${data ? `<div class="message"><strong>Detalhes:</strong><pre>${JSON.stringify(data, null, 2)}</pre></div>` : ""}
              <div class="message">
                <p>
                  <a href="https://estokfy.app/connect" style="background-color: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
                    Ir para Estokfy Connect
                  </a>
                </p>
              </div>
            </div>
            <div class="footer">
              <p>Este é um email automático do Estokfy Connect. Não responda a este email.</p>
              <p>Data: ${new Date().toLocaleString("pt-BR")}</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Log do alerta no banco (para auditoria)
    await svc.from("connect_alerts_log").insert({
      store_id,
      alert_type,
      title,
      message,
      recipient_email,
      data: data || null,
      sent_at: new Date().toISOString(),
    });

    // TODO: Integrar com Resend, SendGrid ou Supabase Email
    // Por enquanto, apenas log o alerta
    console.log(`Alert sent to ${recipient_email}: ${title}`);

    return jsonRes({
      success: true,
      alert_id: Date.now(),
      recipient: recipient_email,
      message: "Alerta enviado com sucesso",
    });
  } catch (e) {
    console.error("connect-alert-email error:", e);
    return jsonRes({ error: "internal_error", details: String(e) }, 500);
  }
});
