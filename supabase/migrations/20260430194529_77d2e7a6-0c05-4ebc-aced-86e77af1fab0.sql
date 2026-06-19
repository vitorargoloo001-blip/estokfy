CREATE OR REPLACE FUNCTION public.resolve_product_ids_by_filter_page(
  p_store_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_filter_key text DEFAULT 'all',
  p_status text DEFAULT 'all',
  p_after_id uuid DEFAULT NULL,
  p_limit int DEFAULT 500
) RETURNS TABLE(id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_term text;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_after uuid := COALESCE(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF v_store IS NULL THEN RETURN; END IF;
  IF p_store_id IS NOT NULL AND p_store_id <> v_store THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  v_term := NULLIF(btrim(COALESCE(p_search, '')), '');

  RETURN QUERY
  SELECT p.id
  FROM public.products p
  WHERE p.store_id = v_store
    AND p.id > v_after
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (p_brand IS NULL OR p.brand = p_brand)
    AND (
      COALESCE(p_status, 'all') = 'all'
      OR (p_status = 'active' AND p.is_active = true)
      OR (p_status = 'inactive' AND p.is_active = false)
    )
    AND (
      v_term IS NULL OR (
        p.name ILIKE '%' || v_term || '%' OR
        p.sku ILIKE '%' || v_term || '%' OR
        COALESCE(p.brand, '') ILIKE '%' || v_term || '%' OR
        COALESCE(p.model, '') ILIKE '%' || v_term || '%'
      )
    )
    AND (
      COALESCE(p_filter_key, 'all') = 'all'
      OR (p_filter_key = 'no_price' AND p.sale_price <= 0)
      OR (p_filter_key = 'no_stock' AND p.on_hand <= 0)
      OR (p_filter_key = 'zero_stock' AND p.on_hand = 0)
      OR (p_filter_key = 'no_min' AND p.minimum_stock <= 0)
    )
  ORDER BY p.id
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_bulk_product_updates(
  p_items jsonb DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL,
  p_filter jsonb DEFAULT NULL,
  p_patch jsonb DEFAULT NULL,
  p_excluded_ids uuid[] DEFAULT '{}'::uuid[],
  p_batch_size int DEFAULT 500,
  p_operation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_store uuid;
  v_patch jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_batch_size int := LEAST(GREATEST(COALESCE(p_batch_size, 500), 1), 500);
  v_ids uuid[] := '{}';
  v_batch_ids uuid[];
  v_item jsonb;
  v_pid uuid;
  v_product record;
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
  v_updated uuid[] := '{}';
  v_errors jsonb := '[]'::jsonb;
  v_total int := 0;
  v_processed int := 0;
  v_success int := 0;
  v_failed int := 0;
  v_filter jsonb := COALESCE(p_filter, '{}'::jsonb);
  v_search text;
  v_category uuid;
  v_brand text;
  v_filter_key text;
  v_status text;
  v_batch_no int;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  v_store := v_ctx.store_id;

  IF v_ctx.role NOT IN ('owner','admin','manager','stock') THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'payload_invalido'; END IF;

  IF p_items IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT NULLIF(x.item->>'product_id','')::uuid), '{}')
    INTO v_ids
    FROM jsonb_array_elements(p_items) AS x(item)
    WHERE NULLIF(x.item->>'product_id','') IS NOT NULL;
  ELSIF p_product_ids IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT pid), '{}') INTO v_ids FROM unnest(p_product_ids) AS pid;
  ELSIF p_filter IS NOT NULL THEN
    IF (v_filter ? 'store_id') AND NULLIF(v_filter->>'store_id','')::uuid <> v_store THEN RAISE EXCEPTION 'sem_permissao'; END IF;
    v_search := NULLIF(btrim(COALESCE(v_filter->>'search', '')), '');
    v_category := NULLIF(v_filter->>'category_id', '')::uuid;
    v_brand := NULLIF(v_filter->>'brand', '');
    v_filter_key := COALESCE(NULLIF(v_filter->>'filter_key', ''), 'all');
    v_status := COALESCE(NULLIF(v_filter->>'status', ''), 'all');
    SELECT COALESCE(array_agg(r.id), '{}') INTO v_ids
    FROM public.resolve_product_ids_by_filter(v_store, v_search, v_category, v_brand, v_filter_key, v_status) r;
  ELSE
    RAISE EXCEPTION 'payload_invalido';
  END IF;

  IF COALESCE(array_length(p_excluded_ids, 1), 0) > 0 THEN
    SELECT COALESCE(array_agg(pid), '{}') INTO v_ids
    FROM unnest(v_ids) AS pid
    WHERE NOT (pid = ANY(p_excluded_ids));
  END IF;

  v_total := COALESCE(array_length(v_ids, 1), 0);
  IF p_items IS NULL AND v_patch = '{}'::jsonb THEN RAISE EXCEPTION 'payload_invalido'; END IF;

  FOR v_batch_no IN 1..GREATEST(CEIL(v_total::numeric / v_batch_size)::int, 0) LOOP
    v_batch_ids := v_ids[((v_batch_no - 1) * v_batch_size + 1):(v_batch_no * v_batch_size)];

    FOREACH v_pid IN ARRAY v_batch_ids LOOP
      v_processed := v_processed + 1;
      v_has_change := false;
      v_stock_delta := 0;
      v_before := '{}'::jsonb;
      v_after := '{}'::jsonb;
      v_changes := '{}'::jsonb;

      BEGIN
        IF p_items IS NOT NULL THEN
          SELECT elem INTO v_item
          FROM jsonb_array_elements(p_items) elem
          WHERE NULLIF(elem->>'product_id','')::uuid = v_pid
          LIMIT 1;
        ELSE
          v_item := jsonb_build_object('product_id', v_pid) || v_patch;
        END IF;

        SELECT * INTO v_product FROM public.products WHERE id = v_pid AND store_id = v_store FOR UPDATE;
        IF NOT FOUND THEN
          v_failed := v_failed + 1;
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'error', 'produto_nao_encontrado'));
          CONTINUE;
        END IF;

        IF v_item ? 'sale_price' AND v_item->>'sale_price' IS NOT NULL THEN
          v_new_price := (v_item->>'sale_price')::numeric;
          IF v_new_price < 0 THEN
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'sku', v_product.sku, 'name', v_product.name, 'error', 'preco_invalido'));
            CONTINUE;
          END IF;
          IF v_new_price <> v_product.sale_price THEN
            v_changes := v_changes || jsonb_build_object('sale_price', v_new_price);
            v_before := v_before || jsonb_build_object('sale_price', v_product.sale_price);
            v_after := v_after || jsonb_build_object('sale_price', v_new_price);
            v_has_change := true;
          END IF;
        END IF;

        IF v_item ? 'on_hand' AND v_item->>'on_hand' IS NOT NULL THEN
          v_new_stock := (v_item->>'on_hand')::int;
          IF v_new_stock < 0 THEN
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'sku', v_product.sku, 'name', v_product.name, 'error', 'estoque_invalido'));
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

        IF v_item ? 'minimum_stock' AND v_item->>'minimum_stock' IS NOT NULL THEN
          v_new_min := (v_item->>'minimum_stock')::int;
          IF v_new_min < 0 THEN
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'sku', v_product.sku, 'name', v_product.name, 'error', 'estoque_minimo_invalido'));
            CONTINUE;
          END IF;
          IF v_new_min <> v_product.minimum_stock THEN
            v_changes := v_changes || jsonb_build_object('minimum_stock', v_new_min);
            v_before := v_before || jsonb_build_object('minimum_stock', v_product.minimum_stock);
            v_after := v_after || jsonb_build_object('minimum_stock', v_new_min);
            v_has_change := true;
          END IF;
        END IF;

        IF v_item ? 'category_id' THEN
          v_new_cat := NULLIF(v_item->>'category_id','')::uuid;
          IF v_new_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = v_new_cat AND c.store_id = v_store) THEN
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'sku', v_product.sku, 'name', v_product.name, 'error', 'categoria_invalida'));
            CONTINUE;
          END IF;
          IF v_new_cat IS DISTINCT FROM v_product.category_id THEN
            v_changes := v_changes || jsonb_build_object('category_id', v_new_cat);
            v_before := v_before || jsonb_build_object('category_id', v_product.category_id);
            v_after := v_after || jsonb_build_object('category_id', v_new_cat);
            v_has_change := true;
          END IF;
        END IF;

        IF v_item ? 'brand' THEN
          v_new_brand := NULLIF(btrim(COALESCE(v_item->>'brand','')), '');
          IF v_new_brand IS DISTINCT FROM v_product.brand THEN
            v_changes := v_changes || jsonb_build_object('brand', v_new_brand);
            v_before := v_before || jsonb_build_object('brand', v_product.brand);
            v_after := v_after || jsonb_build_object('brand', v_new_brand);
            v_has_change := true;
          END IF;
        END IF;

        IF v_item ? 'is_active' AND v_item->>'is_active' IS NOT NULL THEN
          v_new_active := (v_item->>'is_active')::boolean;
          IF v_new_active IS DISTINCT FROM v_product.is_active THEN
            v_changes := v_changes || jsonb_build_object('is_active', v_new_active);
            v_before := v_before || jsonb_build_object('is_active', v_product.is_active);
            v_after := v_after || jsonb_build_object('is_active', v_new_active);
            v_has_change := true;
          END IF;
        END IF;

        IF v_has_change THEN
          UPDATE public.products SET
            sale_price = COALESCE((v_changes->>'sale_price')::numeric, sale_price),
            on_hand = COALESCE((v_changes->>'on_hand')::int, on_hand),
            minimum_stock = COALESCE((v_changes->>'minimum_stock')::int, minimum_stock),
            category_id = CASE WHEN v_changes ? 'category_id' THEN NULLIF(v_changes->>'category_id','')::uuid ELSE category_id END,
            brand = CASE WHEN v_changes ? 'brand' THEN NULLIF(v_changes->>'brand','') ELSE brand END,
            is_active = COALESCE((v_changes->>'is_active')::boolean, is_active),
            updated_at = now()
          WHERE id = v_pid AND store_id = v_store;

          IF v_stock_delta <> 0 THEN
            INSERT INTO public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reason, created_by)
            VALUES (v_store, v_pid, 'adjustment', v_stock_delta, 0, 'Ajuste em massa (RPC)', v_ctx.profile_id);
          END IF;

          INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
          VALUES (v_store, v_ctx.profile_id, 'bulk_update', 'product', v_pid, v_before, jsonb_build_object('note', 'Edição em massa (RPC)', 'changes', v_after));
        END IF;

        v_updated := array_append(v_updated, v_pid);
        v_success := v_success + 1;
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed + 1;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'error', SQLERRM));
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'operation_id', p_operation_id,
    'updated_ids', to_jsonb(v_updated),
    'updated_count', v_success,
    'success_count', v_success,
    'failed_count', v_failed,
    'processed_count', v_processed,
    'total', v_total,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_product_ids_by_filter_page(uuid, text, uuid, text, text, text, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_product_ids_by_filter_page(uuid, text, uuid, text, text, text, uuid, int) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_bulk_product_updates(jsonb, uuid[], jsonb, jsonb, uuid[], int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_bulk_product_updates(jsonb, uuid[], jsonb, jsonb, uuid[], int, uuid) TO authenticated;