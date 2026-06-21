// Estokfy Connect — Edge Function: pluggy-connect-token
// Cria um connect token Pluggy para abrir o widget no frontend.
// Nenhuma credencial é exposta ao cliente — só o connectToken.
//
// Env vars necessárias (Supabase Dashboard → Edge Functions → Env):
//   PLUGGY_CLIENT_ID
//   PLUGGY_CLIENT_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLUGGY_API = "https://api.pluggy.ai";

async function getPluggyApiKey(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${PLUGGY_API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pluggy /auth falhou (${res.status}): ${text.slice(0, 300)}`);
  }
  const { apiKey } = await res.json();
  return apiKey as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const clientId     = Deno.env.get("PLUGGY_CLIENT_ID");
    const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: "PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET não configurados nas env vars da Edge Function." }),
        { status: 503, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Verificar autenticação do usuário Supabase
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Resolver store_id do usuário
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("store_id, role")
      .eq("auth_user_id", user.id)
      .single();

    if (profErr || !profile?.store_id) {
      return new Response(JSON.stringify({ error: "Loja não encontrada" }), {
        status: 403, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Obter API key da Pluggy (curta duração, ~30 min)
    const apiKey = await getPluggyApiKey(clientId, clientSecret);

    // Criar connect token (válido para o widget)
    const connectRes = await fetch(`${PLUGGY_API}/connect_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        clientUserId: profile.store_id, // identificador único do tenant
      }),
    });

    if (!connectRes.ok) {
      const txt = await connectRes.text();
      throw new Error(`Pluggy /connect_tokens falhou (${connectRes.status}): ${txt.slice(0, 300)}`);
    }

    const { accessToken } = await connectRes.json();

    return new Response(
      JSON.stringify({ connectToken: accessToken, storeId: profile.store_id }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[pluggy-connect-token]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
