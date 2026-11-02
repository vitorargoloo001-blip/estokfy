// Estokfy Pixel — Edge Function: pixel-products
//
// A loja online envia os produtos do cliente. Cada item entra no Estokfy como
// um cadastro normal (tabela products, mesmas categorias, mesmo estoque
// inicial). Regras completas em docs/pixel/PRODUTOS_API.md e na migration
// 20261103000001.
//
// Body: { "products": [ { external_id, name, sku?, barcode?, brand?, model?,
//         category?, cost_price?, sale_price?, minimum_stock?, stock?,
//         is_active?, variations?: [ ... ] } ] }
//   - até 200 itens por chamada; cada variação vira um produto próprio.
// Auth: headers x-pixel-id e x-pixel-key (mesmas credenciais do pixel-events).
// Deploy com --no-verify-jwt: quem chama é a loja online, não um usuário.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pixel-id, x-pixel-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Itens que a loja manda por chamada, e o máximo que a função de banco aceita
// depois de expandir as variações.
const MAX_ITEMS = 200;
const MAX_EXPANDED = 500;

// Campos que uma variação herda do produto pai, quando não informa os seus.
const INHERITED_FIELDS = ["brand", "model", "category", "cost_price", "sale_price", "minimum_stock", "is_active"];
// Campos aceitos num item (ou numa variação) e repassados ao banco.
const ITEM_FIELDS = [
  "external_id", "name", "sku", "barcode", "brand", "model", "category",
  "cost_price", "sale_price", "minimum_stock", "stock", "is_active",
];

type Json = Record<string, unknown>;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pick(source: Json, keys: readonly string[]): Json {
  const out: Json = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return out;
}

// Variação vira produto próprio: herda marca, modelo, categoria e preços do pai
// quando não informa os seus. SKU, código de barras, estoque e id são dela.
// Sem o nome da variação, o nome é "Pai - atributo1 / atributo2".
function expand(item: Json): Json[] {
  const variations = Array.isArray(item.variations) ? (item.variations as Json[]) : [];
  if (variations.length === 0) return [pick(item, ITEM_FIELDS)];

  const inherited = pick(item, INHERITED_FIELDS);
  return variations.map((variation) => {
    const attributes = variation.attributes && typeof variation.attributes === "object"
      ? (variation.attributes as Record<string, unknown>)
      : {};
    const suffix = Object.values(attributes)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join(" / ");
    const ownName = typeof variation.name === "string" && variation.name.trim() ? variation.name : null;
    const name = ownName ?? (suffix ? `${item.name} - ${suffix}` : item.name);
    return { ...inherited, ...pick(variation, ITEM_FIELDS), name };
  });
}

// Comparação que não vaza, pelo tempo de resposta, quanto da chave bate.
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Credenciais do pixel (mesmas do pixel-events).
  const pixelId = req.headers.get("x-pixel-id");
  const pixelKey = req.headers.get("x-pixel-key");
  if (!pixelId || !pixelKey) {
    return json({ error: "invalid_pixel", message: "Missing pixel credentials" }, 401);
  }

  const { data: pixel, error: pixelErr } = await supabase
    .from("store_pixels")
    .select("id, store_id, pixel_id, secret_key, is_active, allowed_domains")
    .eq("pixel_id", pixelId)
    .maybeSingle();

  if (pixelErr || !pixel) {
    return json({ error: "invalid_pixel", message: "Pixel not found" }, 401);
  }
  if (!pixel.is_active) {
    return json({ error: "pixel_inactive", message: "Pixel is inactive" }, 403);
  }
  if (!sameSecret(String(pixel.secret_key), pixelKey)) {
    return json({ error: "invalid_signature", message: "Invalid secret key" }, 401);
  }

  // 2. Domínio (opcional; servidor para servidor não manda origin).
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  if (pixel.allowed_domains && pixel.allowed_domains.length > 0 && origin) {
    let originHost = "";
    try { originHost = new URL(origin).hostname; } catch { originHost = ""; }
    if (originHost && !pixel.allowed_domains.some((d: string) => originHost.endsWith(d))) {
      return json({ error: "domain_not_allowed", message: "Origin domain not authorized" }, 403);
    }
  }

  // 3. Corpo.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json", message: "Body must be JSON" }, 400);
  }
  const products = (body as { products?: unknown })?.products;
  if (!Array.isArray(products) || products.length === 0) {
    return json({ error: "invalid_payload", message: "Send { products: [...] } with at least one item" }, 400);
  }
  if (products.length > MAX_ITEMS) {
    return json({ error: "batch_too_large", message: `Up to ${MAX_ITEMS} items per request` }, 400);
  }

  // 4. Expande variações e confere o total que vai para o banco.
  const expanded = products.flatMap((item) =>
    item && typeof item === "object" ? expand(item as Json) : [{ external_id: null }]
  );
  if (expanded.length > MAX_EXPANDED) {
    return json({ error: "batch_too_large", message: `Up to ${MAX_EXPANDED} products after expanding variations` }, 400);
  }

  // 5. Grava pela função de banco (mesmas regras do cadastro manual).
  const { data, error } = await supabase.rpc("pixel_sync_products", {
    p_store_id: pixel.store_id,
    p_products: expanded,
  });
  if (error) {
    const known = error.message.includes("lote_grande_demais") ? 400 : 500;
    return json({ error: "processing_error", message: error.message }, known);
  }

  const result = data as { created: number; updated: number; errors: number; results: Json[] };
  return json({
    status: result.errors > 0 ? "partial" : "success",
    created: result.created,
    updated: result.updated,
    errors: result.errors,
    results: result.results,
  });
});
