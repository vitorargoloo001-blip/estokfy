import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXPECTED = {
  name: Deno.env.get("EXPECTED_PAYEE_NAME") ?? "",
  pix_key: Deno.env.get("EXPECTED_PIX_KEY") ?? "",
  bank: Deno.env.get("EXPECTED_BANK") ?? "",
};

const MAX_RECEIPT_AGE_DAYS = 2;

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes({ error: "Não autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableKey) return jsonRes({ error: "AI não configurada" }, 500);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return jsonRes({ error: "Sessão inválida" }, 401);

    const { verification_id, file_url } = await req.json();
    if (!verification_id || !file_url) return jsonRes({ error: "Dados incompletos" }, 400);

    // Validate file_url path is scoped to the authenticated user's folder
    const storagePath = String(file_url).replace(/^.*payment-receipts\//, "");
    if (!storagePath.startsWith(`${user.id}/`)) {
      return jsonRes({ error: "Arquivo inválido" }, 403);
    }

    const svc = createClient(supabaseUrl, serviceKey);

    const { data: verification, error: vErr } = await svc
      .from("payment_verifications")
      .select("*")
      .eq("id", verification_id)
      .eq("user_id", user.id)
      .single();

    if (vErr || !verification) return jsonRes({ error: "Verificação não encontrada" }, 404);

    await svc.from("payment_verifications").update({
      payment_status: "under_review",
      uploaded_file_url: file_url,
      updated_at: new Date().toISOString(),
    }).eq("id", verification_id);

    // Download file for AI analysis (path already validated above)
    const { data: fileData } = await svc.storage
      .from("payment-receipts")
      .download(storagePath);

    let imageBase64 = "";
    let mimeType = "image/png";

    if (fileData) {
      const buffer = await fileData.arrayBuffer();
      imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      if (file_url.endsWith(".pdf")) mimeType = "application/pdf";
      else if (file_url.endsWith(".jpg") || file_url.endsWith(".jpeg")) mimeType = "image/jpeg";
    }

    const todayStr = new Date().toISOString().split("T")[0];

    const aiPrompt = `Analise este comprovante de pagamento Pix e extraia informações.

DADOS ESPERADOS DO RECEBEDOR:
- Nome: ${EXPECTED.name}
- Chave Pix (CPF): ${EXPECTED.pix_key}
- Banco: ${EXPECTED.bank}

DATA ATUAL: ${todayStr}
JANELA MÁXIMA: ${MAX_RECEIPT_AGE_DAYS} dias atrás

INSTRUÇÕES:
1. Extraia: nome do recebedor, chave Pix, valor pago, data do pagamento
2. Compare nome e chave Pix com os dados esperados
3. Verifique se a DATA do comprovante é recente (dentro de ${MAX_RECEIPT_AGE_DAYS} dias da data atual)
4. Verifique se o comprovante parece autêntico (formatação, layout de banco real)
5. Dê um score de confiança de 0 a 100

IMPORTANTE: Você NÃO está aprovando ou liberando acesso. Você está apenas CLASSIFICANDO o comprovante para revisão posterior por um administrador humano.

REGRAS DE CLASSIFICAÇÃO:
- O VALOR PAGO NÃO é critério de classificação. Extraia-o mas não use para decidir.
- LOOKS_VALID: nome e/ou chave Pix batem, data é recente (≤${MAX_RECEIPT_AGE_DAYS} dias), comprovante parece autêntico (confiança >= 75)
- LOOKS_INVALID: dados do recebedor claramente errados, OU data muito antiga (>7 dias), OU comprovante visivelmente falso/manipulado
- NEEDS_REVIEW: dados parcialmente legíveis, confiança entre 50-74, data entre ${MAX_RECEIPT_AGE_DAYS}-7 dias, ou ambiguidade

Para date_is_recent: true se a data está dentro de ${MAX_RECEIPT_AGE_DAYS} dias, false caso contrário.
Para date_validation_result: "valid" se recente, "expired" se antiga, "unreadable" se não conseguir ler a data.

Responda APENAS com o resultado da análise via tool call.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: aiPrompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "analyze_receipt",
              description: "Return structured classification of a payment receipt for admin review",
              parameters: {
                type: "object",
                properties: {
                  classification: { type: "string", enum: ["looks_valid", "looks_invalid", "needs_review"] },
                  confidence: { type: "number", description: "0-100 confidence score" },
                  extracted_name: { type: "string", description: "Name found on receipt" },
                  extracted_amount: { type: "number", description: "Amount paid (informational only)" },
                  extracted_date: { type: "string", description: "Payment date found (YYYY-MM-DD)" },
                  extracted_pix_key: { type: "string", description: "Pix key found on receipt" },
                  date_is_recent: { type: "boolean", description: "Whether date is within allowed window" },
                  date_validation_result: { type: "string", enum: ["valid", "expired", "unreadable"] },
                  reason: { type: "string", description: "Brief explanation of classification in Portuguese" },
                },
                required: ["classification", "confidence", "reason", "date_is_recent", "date_validation_result"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "analyze_receipt" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("[verify-payment] AI error:", aiResponse.status, errText);

      if (aiResponse.status === 429) return jsonRes({ error: "Limite de requisições atingido. Tente novamente em alguns minutos." }, 429);
      if (aiResponse.status === 402) return jsonRes({ error: "Créditos de IA insuficientes." }, 402);

      // AI failed — still set to waiting_admin_approval so admin can review manually
      await svc.from("payment_verifications").update({
        payment_status: "waiting_admin_approval",
        ai_reason: "Falha na análise automática — aguardando revisão manual",
        reviewer_type: "ai_error",
        updated_at: new Date().toISOString(),
      }).eq("id", verification_id);

      return jsonRes({ status: "waiting_admin_approval", reason: "Seu comprovante foi recebido e será analisado pelo administrador." });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    let result: {
      classification: string;
      confidence: number;
      extracted_name?: string;
      extracted_amount?: number;
      extracted_date?: string;
      extracted_pix_key?: string;
      date_is_recent?: boolean;
      date_validation_result?: string;
      reason: string;
    };

    if (toolCall?.function?.arguments) {
      result = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } else {
      result = { classification: "needs_review", confidence: 0, reason: "Resposta da IA não estruturada", date_is_recent: false, date_validation_result: "unreadable" };
    }

    // Map AI classification to match_result for admin reference
    let matchResult = "no_match";
    if (result.classification === "looks_valid") matchResult = "full_match";
    else if (result.classification === "needs_review") matchResult = "partial_match";

    // CRITICAL: Always set to waiting_admin_approval — NEVER auto-approve
    // The AI only classifies; the admin makes the final decision
    await svc.from("payment_verifications").update({
      payment_status: "waiting_admin_approval",
      ai_confidence: result.confidence,
      ai_reason: result.reason,
      extracted_name: result.extracted_name || null,
      extracted_amount: result.extracted_amount || null,
      extracted_date: result.extracted_date || null,
      extracted_pix_key: result.extracted_pix_key || null,
      date_is_recent: result.date_is_recent ?? null,
      date_validation_result: result.date_validation_result || null,
      match_result: matchResult,
      reviewer_type: "ai",
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", verification_id);

    // Log AI analysis (access is NOT granted here)
    await svc.from("audit_logs").insert({
      store_id: verification.store_id,
      action: "payment_ai_analyzed",
      entity: "payment_verification",
      entity_id: verification_id,
      after_json: {
        classification: result.classification,
        confidence: result.confidence,
        reason: result.reason,
        match_result: matchResult,
      },
    });

    return jsonRes({
      status: "waiting_admin_approval",
      ai_classification: result.classification,
      reason: result.reason,
      confidence: result.confidence,
    });
  } catch (err) {
    console.error("[verify-payment] Error:", err);
    return jsonRes({ error: "Erro interno ao processar verificação" }, 500);
  }
});
