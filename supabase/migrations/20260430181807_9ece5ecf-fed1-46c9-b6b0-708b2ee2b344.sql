
-- =========================================================
-- 1) Tabela de log de operações em massa
-- =========================================================
CREATE TABLE IF NOT EXISTS public.bulk_operations_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  actor_profile_id uuid,
  operation text NOT NULL,
  total_requested int NOT NULL DEFAULT 0,
  total_updated int NOT NULL DEFAULT 0,
  total_failed int NOT NULL DEFAULT 0,
  fields_changed text[] NOT NULL DEFAULT '{}',
  duration_ms int,
  errors_json jsonb,
  filter_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bulk_operations_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_log_select ON public.bulk_operations_log;
CREATE POLICY bulk_log_select ON public.bulk_operations_log
  FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());

DROP POLICY IF EXISTS bulk_log_insert ON public.bulk_operations_log;
CREATE POLICY bulk_log_insert ON public.bulk_operations_log
  FOR INSERT TO authenticated
  WITH CHECK (store_id = public.get_my_store_id());

CREATE INDEX IF NOT EXISTS idx_bulk_log_store_created
  ON public.bulk_operations_log(store_id, created_at DESC);

-- =========================================================
-- 2) Função: count_products_by_filter
-- =========================================================
CREATE OR REPLACE FUNCTION public.count_products_by_filter(
  p_search text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_filter_key text DEFAULT 'all'
) RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_count bigint;
  v_term text;
BEGIN
  IF v_store IS NULL THEN RETURN 0; END IF;
  v_term := NULLIF(btrim(p_search), '');

  SELECT COUNT(*)::bigint INTO v_count
  FROM public.products p
  WHERE p.store_id = v_store
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (p_brand IS NULL OR p.brand = p_brand)
    AND (
      v_term IS NULL OR (
        p.name ILIKE '%'||v_term||'%' OR
        p.sku ILIKE '%'||v_term||'%' OR
        COALESCE(p.brand,'') ILIKE '%'||v_term||'%' OR
        COALESCE(p.model,'') ILIKE '%'||v_term||'%'
      )
    )
    AND (
      p_filter_key = 'all'
      OR (p_filter_key = 'no_price'    AND p.sale_price <= 0)
      OR (p_filter_key = 'no_stock'    AND p.on_hand <= 0)
      OR (p_filter_key = 'zero_stock'  AND p.on_hand = 0)
      OR (p_filter_key = 'no_min'      AND p.minimum_stock <= 0)
    );

  RETURN COALESCE(v_count, 0);
END;
$$;

-- =========================================================
-- 3) Função: resolve_product_ids_by_filter (paginada)
-- =========================================================
CREATE OR REPLACE FUNCTION public.resolve_product_ids_by_filter(
  p_search text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_filter_key text DEFAULT 'all',
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 1000
) RETURNS TABLE(id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_term text;
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
  v_off int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF v_store IS NULL THEN RETURN; END IF;
  v_term := NULLIF(btrim(p_search), '');

  RETURN QUERY
  SELECT p.id
  FROM public.products p
  WHERE p.store_id = v_store
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (p_brand IS NULL OR p.brand = p_brand)
    AND (
      v_term IS NULL OR (
        p.name ILIKE '%'||v_term||'%' OR
        p.sku ILIKE '%'||v_term||'%' OR
        COALESCE(p.brand,'') ILIKE '%'||v_term||'%' OR
        COALESCE(p.model,'') ILIKE '%'||v_term||'%'
      )
    )
    AND (
      p_filter_key = 'all'
      OR (p_filter_key = 'no_price'    AND p.sale_price <= 0)
      OR (p_filter_key = 'no_stock'    AND p.on_hand <= 0)
      OR (p_filter_key = 'zero_stock'  AND p.on_hand = 0)
      OR (p_filter_key = 'no_min'      AND p.minimum_stock <= 0)
    )
  ORDER BY p.on_hand DESC, p.name ASC
  OFFSET v_off LIMIT v_lim;
END;
$$;

-- =========================================================
-- 4) Função: apply_bulk_product_updates (em lote)
-- p_items: jsonb array de objetos:
--   { product_id, sale_price?, on_hand?, minimum_stock?,
--     category_id?, brand?, is_active? }
-- Retorno: { updated_ids: uuid[], errors: [{product_id, error}] }
-- =========================================================
CREATE OR REPLACE FUNCTION public.apply_bulk_product_updates(
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_item jsonb;
  v_pid uuid;
  v_product record;
  v_updated uuid[] := '{}';
  v_errors jsonb := '[]'::jsonb;
  v_total int := 0;
  v_changes jsonb;
  v_new_price numeric;
  v_new_stock int;
  v_new_min int;
  v_new_cat uuid;
  v_new_brand text;
  v_new_active boolean;
  v_stock_delta int;
  v_before jsonb;
  v_after jsonb;
  v_has_change boolean;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();

  IF v_ctx.role NOT IN ('owner','admin','manager','stock') THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'payload_invalido';
  END IF;

  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'lote_muito_grande';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_total := v_total + 1;
    v_has_change := false;
    v_stock_delta := 0;
    v_before := '{}'::jsonb;
    v_after := '{}'::jsonb;
    v_changes := '{}'::jsonb;

    BEGIN
      v_pid := NULLIF(v_item->>'product_id','')::uuid;
      IF v_pid IS NULL THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', NULL, 'error', 'product_id_invalido'));
        CONTINUE;
      END IF;

      SELECT * INTO v_product FROM public.products
        WHERE id = v_pid AND store_id = v_ctx.store_id
        FOR UPDATE;

      IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'error', 'produto_nao_encontrado'));
        CONTINUE;
      END IF;

      -- sale_price
      IF v_item ? 'sale_price' AND v_item->>'sale_price' IS NOT NULL THEN
        v_new_price := (v_item->>'sale_price')::numeric;
        IF v_new_price < 0 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'error', 'preco_invalido'));
          CONTINUE;
        END IF;
        IF v_new_price <> v_product.sale_price THEN
          v_changes := v_changes || jsonb_build_object('sale_price', v_new_price);
          v_before := v_before || jsonb_build_object('sale_price', v_product.sale_price);
          v_after := v_after || jsonb_build_object('sale_price', v_new_price);
          v_has_change := true;
        END IF;
      END IF;

      -- on_hand
      IF v_item ? 'on_hand' AND v_item->>'on_hand' IS NOT NULL THEN
        v_new_stock := (v_item->>'on_hand')::int;
        IF v_new_stock < 0 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'error', 'estoque_invalido'));
          CONTINUE;
        END IF;
        IF v_new_stock <> v_product.on_hand THEN
          v_stock_delta := v_new_stock - v_product.on_hand;
          v_changes := v_changes || jsonb_build_object('on_hand', v_new_stock);
          v_before := v_before || jsonb_build_object('on_hand', v_product.on_hand);
          v_after := v_after || jsonb_build_object('on_hand', v_new_stock);
          v_has_change := true;
        END IF;
      END IF;

      -- minimum_stock
      IF v_item ? 'minimum_stock' AND v_item->>'minimum_stock' IS NOT NULL THEN
        v_new_min := (v_item->>'minimum_stock')::int;
        IF v_new_min < 0 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'error', 'minimo_invalido'));
          CONTINUE;
        END IF;
        IF v_new_min <> v_product.minimum_stock THEN
          v_changes := v_changes || jsonb_build_object('minimum_stock', v_new_min);
          v_before := v_before || jsonb_build_object('minimum_stock', v_product.minimum_stock);
          v_after := v_after || jsonb_build_object('minimum_stock', v_new_min);
          v_has_change := true;
        END IF;
      END IF;

      -- category_id (pode ser null)
      IF v_item ? 'category_id' THEN
        v_new_cat := NULLIF(v_item->>'category_id','')::uuid;
        IF v_new_cat IS DISTINCT FROM v_product.category_id THEN
          v_changes := v_changes || jsonb_build_object('category_id', v_new_cat);
          v_before := v_before || jsonb_build_object('category_id', v_product.category_id);
          v_after := v_after || jsonb_build_object('category_id', v_new_cat);
          v_has_change := true;
        END IF;
      END IF;

      -- brand
      IF v_item ? 'brand' THEN
        v_new_brand := NULLIF(btrim(COALESCE(v_item->>'brand','')), '');
        IF v_new_brand IS DISTINCT FROM v_product.brand THEN
          v_changes := v_changes || jsonb_build_object('brand', v_new_brand);
          v_before := v_before || jsonb_build_object('brand', v_product.brand);
          v_after := v_after || jsonb_build_object('brand', v_new_brand);
          v_has_change := true;
        END IF;
      END IF;

      -- is_active
      IF v_item ? 'is_active' AND v_item->>'is_active' IS NOT NULL THEN
        v_new_active := (v_item->>'is_active')::boolean;
        IF v_new_active IS DISTINCT FROM v_product.is_active THEN
          v_changes := v_changes || jsonb_build_object('is_active', v_new_active);
          v_before := v_before || jsonb_build_object('is_active', v_product.is_active);
          v_after := v_after || jsonb_build_object('is_active', v_new_active);
          v_has_change := true;
        END IF;
      END IF;

      IF NOT v_has_change THEN
        -- Não conta como erro, simplesmente nada a fazer
        CONTINUE;
      END IF;

      UPDATE public.products SET
        sale_price    = COALESCE((v_changes->>'sale_price')::numeric, sale_price),
        on_hand       = COALESCE((v_changes->>'on_hand')::int, on_hand),
        minimum_stock = COALESCE((v_changes->>'minimum_stock')::int, minimum_stock),
        category_id   = CASE WHEN v_changes ? 'category_id' THEN NULLIF(v_changes->>'category_id','')::uuid ELSE category_id END,
        brand         = CASE WHEN v_changes ? 'brand' THEN NULLIF(v_changes->>'brand','') ELSE brand END,
        is_active     = COALESCE((v_changes->>'is_active')::boolean, is_active),
        updated_at    = now()
      WHERE id = v_pid;

      IF v_stock_delta <> 0 THEN
        INSERT INTO public.stock_movements(
          store_id, product_id, movement_type, qty, unit_cost,
          reason, created_by
        ) VALUES (
          v_ctx.store_id, v_pid, 'adjustment', v_stock_delta, 0,
          'Ajuste em massa (RPC)', v_ctx.profile_id
        );
      END IF;

      INSERT INTO public.audit_logs(
        store_id, actor_profile_id, action, entity, entity_id,
        before_json, after_json
      ) VALUES (
        v_ctx.store_id, v_ctx.profile_id, 'bulk_update', 'product', v_pid,
        v_before,
        jsonb_build_object('note','Edição em massa (RPC)','changes', v_after)
      );

      v_updated := array_append(v_updated, v_pid);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_pid,
        'error', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'updated_ids', to_jsonb(v_updated),
    'updated_count', COALESCE(array_length(v_updated, 1), 0),
    'failed_count', jsonb_array_length(v_errors),
    'total', v_total,
    'errors', v_errors
  );
END;
$$;
