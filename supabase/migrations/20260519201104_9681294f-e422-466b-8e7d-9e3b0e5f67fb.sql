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

  IF v_ctx.role NOT IN ('owner','admin','manager','stock') THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  IF p_product IS NULL OR jsonb_typeof(p_product) <> 'object' THEN RAISE EXCEPTION 'payload_invalido'; END IF;
  IF COALESCE(NULLIF(p_product->>'store_id','')::uuid, v_store) <> v_store THEN RAISE EXCEPTION 'store_invalida'; END IF;

  v_product_id := COALESCE(NULLIF(p_product->>'id','')::uuid, gen_random_uuid());
  SELECT * INTO v_existing FROM public.products WHERE id = v_product_id AND store_id = v_store FOR UPDATE;
  v_is_update := FOUND;

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
  IF v_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = v_category_id AND c.store_id = v_store) THEN RAISE EXCEPTION 'categoria_invalida'; END IF;
  IF v_sku IS NOT NULL AND EXISTS (SELECT 1 FROM public.products p WHERE p.store_id = v_store AND p.sku = v_sku AND p.id <> v_product_id) THEN RAISE EXCEPTION 'sku_duplicado'; END IF;
  IF v_barcode IS NOT NULL AND EXISTS (SELECT 1 FROM public.products p WHERE p.store_id = v_store AND p.barcode = v_barcode AND p.id <> v_product_id) THEN RAISE EXCEPTION 'barcode_duplicado'; END IF;

  IF v_is_update THEN
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
    IF v_stock_product IS NULL OR v_stock_product <> v_product_id THEN RAISE EXCEPTION 'product_id_invalido'; END IF;
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
      sku = v_sku, name = v_name, brand = v_brand, model = v_model, category_id = v_category_id,
      cost_price = v_cost_price, sale_price = v_sale_price, minimum_stock = v_minimum_stock,
      on_hand = v_new_stock, barcode = v_barcode, image_path = COALESCE(v_image_path, image_path), updated_at = now()
    WHERE id = v_product_id AND store_id = v_store;
  ELSE
    INSERT INTO public.products(id, store_id, sku, name, brand, model, category_id, cost_price, sale_price, minimum_stock, on_hand, barcode, image_path, is_active)
    VALUES (v_product_id, v_store, v_sku, v_name, v_brand, v_model, v_category_id, v_cost_price, v_sale_price, v_minimum_stock, v_new_stock, v_barcode, v_image_path, true);
  END IF;

  IF v_delta <> 0 THEN
    INSERT INTO public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reason, reference_type, reference_id, created_by)
    VALUES (
      v_store, v_product_id, v_movement_type, v_delta, v_unit_cost,
      COALESCE(v_reason, CASE WHEN v_movement_type = 'initial_stock' THEN 'Estoque inicial' ELSE 'Ajuste manual via edição do produto' END),
      CASE WHEN v_is_update THEN 'product_edit' ELSE 'product_create' END,
      v_product_id,
      v_ctx.profile_id
    );
  END IF;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (
    v_store, v_ctx.profile_id,
    CASE WHEN v_is_update THEN 'product_update_with_stock' ELSE 'product_create_with_stock' END,
    'product', v_product_id,
    CASE WHEN v_is_update THEN jsonb_build_object('on_hand', v_previous_stock) ELSE NULL END,
    jsonb_build_object('product_id', v_product_id, 'previous_stock', v_previous_stock, 'new_stock', v_new_stock, 'quantity', v_delta, 'movement_type', v_movement_type, 'stock_movement_created', v_delta <> 0)
  );

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id, 'previous_stock', v_previous_stock, 'new_stock', v_new_stock, 'quantity', v_delta, 'movement_type', v_movement_type, 'stock_movement_created', v_delta <> 0);
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_update_product_with_stock(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_or_update_product_with_stock(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_or_update_product_with_stock(jsonb, jsonb) TO authenticated;