CREATE OR REPLACE FUNCTION public.create_or_update_product_with_stock(
  p_product jsonb,
  p_stock jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_store uuid;
  v_product_id uuid;
  v_existing public.products%ROWTYPE;
  v_is_update boolean := false;
  v_name text;
  v_sku text;
  v_barcode text;
  v_brand text;
  v_model text;
  v_category_id uuid;
  v_cost_price numeric;
  v_sale_price numeric;
  v_minimum_stock int;
  v_requested_stock int;
  v_previous_stock int := 0;
  v_new_stock int := 0;
  v_delta int := 0;
  v_movement_type text;
  v_reason text;
  v_stock_store uuid;
  v_stock_product uuid;
  v_created_by uuid;
  v_unit_cost numeric;
  v_image_path text;
  v_allowed_types text[] := ARRAY['initial_stock','purchase_in','sale_out','adjustment','return_in','return_out','manual_in','manual_out','loss'];
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  v_store := v_ctx.store_id;

  IF v_ctx.role NOT IN ('owner','admin','manager','stock') THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  IF p_product IS NULL OR jsonb_typeof(p_product) <> 'object' THEN
    RAISE EXCEPTION 'payload_invalido';
  END IF;
  IF COALESCE(NULLIF(p_product->>'store_id','')::uuid, v_store) <> v_store THEN
    RAISE EXCEPTION 'store_invalida';
  END IF;

  v_product_id := NULLIF(p_product->>'id','')::uuid;
  v_is_update := v_product_id IS NOT NULL;
  v_name := NULLIF(btrim(COALESCE(p_product->>'name','')), '');
  v_sku := NULLIF(btrim(COALESCE(p_product->>'sku','')), '');
  v_barcode := NULLIF(btrim(COALESCE(p_product->>'barcode','')), '');
  v_brand := NULLIF(btrim(COALESCE(p_product->>'brand','')), '');
  v_model := NULLIF(btrim(COALESCE(p_product->>'model','')), '');
  v_category_id := NULLIF(p_product->>'category_id','')::uuid;
  v_cost_price := COALESCE(NULLIF(p_product->>'cost_price','')::numeric, 0);
  v_sale_price := COALESCE(NULLIF(p_product->>'sale_price','')::numeric, 0);
  v_minimum_stock := COALESCE(NULLIF(p_product->>'minimum_stock','')::int, 0);
  v_image_path := NULLIF(p_product->>'image_path','');

  IF v_name IS NULL THEN RAISE EXCEPTION 'nome_obrigatorio'; END IF;
  IF v_cost_price < 0 THEN RAISE EXCEPTION 'custo_invalido'; END IF;
  IF v_sale_price < 0 THEN RAISE EXCEPTION 'preco_invalido'; END IF;
  IF v_minimum_stock < 0 THEN RAISE EXCEPTION 'estoque_minimo_invalido'; END IF;
  IF v_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = v_category_id AND c.store_id = v_store) THEN
    RAISE EXCEPTION 'categoria_invalida';
  END IF;
  IF v_sku IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.store_id = v_store AND p.sku = v_sku AND (v_product_id IS NULL OR p.id <> v_product_id)
  ) THEN
    RAISE EXCEPTION 'sku_duplicado';
  END IF;
  IF v_barcode IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.store_id = v_store AND p.barcode = v_barcode AND (v_product_id IS NULL OR p.id <> v_product_id)
  ) THEN
    RAISE EXCEPTION 'barcode_duplicado';
  END IF;

  IF v_is_update THEN
    SELECT * INTO v_existing FROM public.products WHERE id = v_product_id AND store_id = v_store FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
    v_previous_stock := v_existing.on_hand;
    v_requested_stock := COALESCE(NULLIF(p_product->>'on_hand','')::int, v_existing.on_hand);
  ELSE
    v_previous_stock := 0;
    v_requested_stock := COALESCE(NULLIF(p_product->>'on_hand','')::int, 0);
  END IF;

  IF v_requested_stock < 0 THEN RAISE EXCEPTION 'estoque_invalido'; END IF;
  v_new_stock := v_requested_stock;
  v_delta := v_new_stock - v_previous_stock;

  IF p_stock IS NOT NULL THEN
    IF jsonb_typeof(p_stock) <> 'object' THEN RAISE EXCEPTION 'payload_estoque_invalido'; END IF;
    v_stock_store := NULLIF(p_stock->>'store_id','')::uuid;
    IF v_stock_store IS NULL OR v_stock_store <> v_store THEN RAISE EXCEPTION 'store_invalida'; END IF;
    v_stock_product := NULLIF(p_stock->>'product_id','')::uuid;
    IF v_is_update AND (v_stock_product IS NULL OR v_stock_product <> v_product_id) THEN RAISE EXCEPTION 'product_id_invalido'; END IF;
    v_created_by := NULLIF(p_stock->>'created_by','')::uuid;
    IF v_created_by IS NULL OR v_created_by <> auth.uid() THEN RAISE EXCEPTION 'user_id_invalido'; END IF;
    IF COALESCE(NULLIF(p_stock->>'previous_stock','')::int, v_previous_stock) <> v_previous_stock THEN RAISE EXCEPTION 'estoque_anterior_invalido'; END IF;
    IF COALESCE(NULLIF(p_stock->>'new_stock','')::int, v_new_stock) <> v_new_stock THEN RAISE EXCEPTION 'estoque_novo_invalido'; END IF;
    IF COALESCE(NULLIF(p_stock->>'quantity','')::int, v_delta) <> v_delta THEN RAISE EXCEPTION 'quantidade_invalida'; END IF;
    v_movement_type := COALESCE(NULLIF(p_stock->>'movement_type',''), CASE WHEN NOT v_is_update AND v_delta > 0 THEN 'initial_stock' ELSE 'adjustment' END);
    IF NOT (v_movement_type = ANY(v_allowed_types)) THEN RAISE EXCEPTION 'movement_type_invalido'; END IF;
  ELSE
    v_movement_type := CASE WHEN NOT v_is_update AND v_delta > 0 THEN 'initial_stock' ELSE 'adjustment' END;
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_stock->>'reason','')), '');
  v_unit_cost := COALESCE(NULLIF(p_stock->>'unit_cost','')::numeric, v_cost_price, 0);
  IF v_unit_cost < 0 THEN RAISE EXCEPTION 'custo_invalido'; END IF;
  IF v_delta = 0 THEN v_movement_type := NULL; END IF;

  IF v_is_update THEN
    UPDATE public.products SET
      sku = v_sku,
      name = v_name,
      brand = v_brand,
      model = v_model,
      category_id = v_category_id,
      cost_price = v_cost_price,
      sale_price = v_sale_price,
      minimum_stock = v_minimum_stock,
      on_hand = v_new_stock,
      barcode = v_barcode,
      image_path = COALESCE(v_image_path, image_path),
      updated_at = now()
    WHERE id = v_product_id AND store_id = v_store;
  ELSE
    INSERT INTO public.products(
      store_id, sku, name, brand, model, category_id, cost_price, sale_price,
      minimum_stock, on_hand, barcode, image_path, is_active
    ) VALUES (
      v_store, v_sku, v_name, v_brand, v_model, v_category_id, v_cost_price, v_sale_price,
      v_minimum_stock, v_new_stock, v_barcode, v_image_path, true
    ) RETURNING id INTO v_product_id;
  END IF;

  IF v_delta <> 0 THEN
    INSERT INTO public.stock_movements(
      store_id, product_id, movement_type, qty, unit_cost, reason,
      reference_type, reference_id, created_by
    ) VALUES (
      v_store, v_product_id, v_movement_type, v_delta, v_unit_cost,
      COALESCE(v_reason, CASE WHEN v_movement_type = 'initial_stock' THEN 'Estoque inicial' ELSE 'Ajuste manual via edição do produto' END),
      CASE WHEN v_is_update THEN 'product_edit' ELSE 'product_create' END,
      v_product_id,
      v_ctx.profile_id
    );
  END IF;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (
    v_store,
    v_ctx.profile_id,
    CASE WHEN v_is_update THEN 'product_update_with_stock' ELSE 'product_create_with_stock' END,
    'product',
    v_product_id,
    CASE WHEN v_is_update THEN jsonb_build_object('on_hand', v_previous_stock) ELSE NULL END,
    jsonb_build_object(
      'product_id', v_product_id,
      'previous_stock', v_previous_stock,
      'new_stock', v_new_stock,
      'quantity', v_delta,
      'movement_type', v_movement_type,
      'stock_movement_created', v_delta <> 0
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_product_id,
    'previous_stock', v_previous_stock,
    'new_stock', v_new_stock,
    'quantity', v_delta,
    'movement_type', v_movement_type,
    'stock_movement_created', v_delta <> 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_or_update_product_with_stock(jsonb, jsonb) TO authenticated;

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
            INSERT INTO public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reason, reference_type, reference_id, created_by)
            VALUES (v_store, v_pid, 'adjustment', v_stock_delta, 0, 'Ajuste em massa (RPC)', 'bulk_product_update', v_pid, v_ctx.profile_id);
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

GRANT EXECUTE ON FUNCTION public.apply_bulk_product_updates(jsonb, uuid[], jsonb, jsonb, uuid[], int, uuid) TO authenticated;

DROP POLICY IF EXISTS stock_movements_select ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_insert ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_update ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_delete ON public.stock_movements;

CREATE POLICY stock_movements_select
ON public.stock_movements
FOR SELECT
TO authenticated
USING (store_id = public.get_my_store_id());

CREATE POLICY stock_movements_insert
ON public.stock_movements
FOR INSERT
TO authenticated
WITH CHECK (
  store_id = public.get_my_store_id()
  AND public.get_my_role() IN ('owner','admin','manager','stock')
);

CREATE POLICY stock_movements_update
ON public.stock_movements
FOR UPDATE
TO authenticated
USING (
  store_id = public.get_my_store_id()
  AND public.get_my_role() IN ('owner','admin','manager')
)
WITH CHECK (store_id = public.get_my_store_id());

CREATE POLICY stock_movements_delete
ON public.stock_movements
FOR DELETE
TO authenticated
USING (
  store_id = public.get_my_store_id()
  AND public.get_my_role() IN ('owner','admin','manager')
);