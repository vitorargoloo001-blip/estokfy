-- =====================================================================
-- Estokfy Pixel: histórico de sincronização de produtos com o motivo dos erros.
--
-- Igual à migration 20261103000001, com uma diferença: o registro de auditoria
-- de cada lote (action = 'pixel_products_sync') passa a guardar errors_detail,
-- até 50 itens com external_id e o motivo. A tela Estokfy Pixel → Produtos lê
-- esse histórico. Nada mais muda: mesmas regras, mesmas permissões.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.pixel_sync_products(p_store_id uuid, p_products jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item        jsonb;
  v_ext         text;
  v_name        text;
  v_sku         text;
  v_barcode     text;
  v_brand       text;
  v_model       text;
  v_category    text;
  v_category_id uuid;
  v_cost        numeric;
  v_price       numeric;
  v_min         integer;
  v_stock       integer;
  v_active      boolean;
  v_existing    public.products%ROWTYPE;
  v_found       boolean;
  v_product_id  uuid;
  v_action      text;
  v_results     jsonb := '[]'::jsonb;
  v_created     integer := 0;
  v_updated     integer := 0;
  v_errors      integer := 0;
  v_error_sample jsonb := '[]'::jsonb;
BEGIN
  IF p_store_id IS NULL THEN RAISE EXCEPTION 'store_obrigatoria'; END IF;
  IF p_products IS NULL OR jsonb_typeof(p_products) <> 'array' THEN RAISE EXCEPTION 'payload_invalido'; END IF;
  IF jsonb_array_length(p_products) > 500 THEN RAISE EXCEPTION 'lote_grande_demais'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN RAISE EXCEPTION 'store_invalida'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_products)
  LOOP
    v_ext := NULLIF(btrim(COALESCE(v_item->>'external_id', '')), '');
    v_product_id := NULL;
    v_action := NULL;

    BEGIN
      v_name     := NULLIF(btrim(COALESCE(v_item->>'name', '')), '');
      v_sku      := NULLIF(btrim(COALESCE(v_item->>'sku', '')), '');
      v_barcode  := NULLIF(btrim(COALESCE(v_item->>'barcode', '')), '');
      v_brand    := NULLIF(btrim(COALESCE(v_item->>'brand', '')), '');
      v_model    := NULLIF(btrim(COALESCE(v_item->>'model', '')), '');
      v_category := NULLIF(regexp_replace(btrim(COALESCE(v_item->>'category', '')), '\s+', ' ', 'g'), '');
      v_cost     := NULLIF(v_item->>'cost_price', '')::numeric;
      v_price    := NULLIF(v_item->>'sale_price', '')::numeric;
      v_min      := NULLIF(v_item->>'minimum_stock', '')::integer;
      v_stock    := NULLIF(v_item->>'stock', '')::integer;
      v_active   := NULLIF(v_item->>'is_active', '')::boolean;

      IF v_ext IS NULL THEN RAISE EXCEPTION 'external_id_obrigatorio'; END IF;
      IF v_name IS NULL THEN RAISE EXCEPTION 'nome_obrigatorio'; END IF;
      IF v_cost IS NOT NULL AND v_cost < 0 THEN RAISE EXCEPTION 'custo_invalido'; END IF;
      IF v_price IS NOT NULL AND v_price < 0 THEN RAISE EXCEPTION 'preco_invalido'; END IF;
      IF v_min IS NOT NULL AND v_min < 0 THEN RAISE EXCEPTION 'estoque_minimo_invalido'; END IF;
      IF v_stock IS NOT NULL AND v_stock < 0 THEN RAISE EXCEPTION 'estoque_invalido'; END IF;

      -- 1. Produto já ligado a este id da loja online.
      SELECT * INTO v_existing FROM public.products
       WHERE store_id = p_store_id AND external_id = v_ext
       FOR UPDATE;
      v_found := FOUND;

      -- 2. Sem id: pelo SKU. Se o SKU já pertence a outro id da loja online, erro.
      IF NOT v_found AND v_sku IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.products
         WHERE store_id = p_store_id AND sku = v_sku
         FOR UPDATE;
        IF FOUND THEN
          IF v_existing.external_id IS NOT NULL THEN RAISE EXCEPTION 'sku_ja_ligado_a_outro_produto_da_loja_online'; END IF;
          v_found := true;
        END IF;
      END IF;

      -- 3. Sem SKU: pelo código de barras, com a mesma regra.
      IF NOT v_found AND v_barcode IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.products
         WHERE store_id = p_store_id AND barcode = v_barcode
         FOR UPDATE;
        IF FOUND THEN
          IF v_existing.external_id IS NOT NULL THEN RAISE EXCEPTION 'barcode_ja_ligado_a_outro_produto_da_loja_online'; END IF;
          v_found := true;
        END IF;
      END IF;

      -- Categoria: mesma loja, sem diferenciar maiúsculas. Cria se não existir.
      v_category_id := NULL;
      IF v_category IS NOT NULL THEN
        SELECT c.id INTO v_category_id FROM public.categories c
         WHERE c.store_id = p_store_id AND lower(c.name) = lower(v_category)
         LIMIT 1;
        IF v_category_id IS NULL THEN
          INSERT INTO public.categories (store_id, name, is_active)
          VALUES (p_store_id, v_category, true)
          RETURNING id INTO v_category_id;
        END IF;
      END IF;

      IF v_found THEN
        UPDATE public.products SET
          external_id   = v_ext,
          sku           = COALESCE(v_sku, sku),
          barcode       = COALESCE(v_barcode, barcode),
          name          = v_name,
          brand         = COALESCE(v_brand, brand),
          model         = COALESCE(v_model, model),
          category_id   = COALESCE(v_category_id, category_id),
          cost_price    = COALESCE(v_cost, cost_price),
          sale_price    = COALESCE(v_price, sale_price),
          minimum_stock = COALESCE(v_min, minimum_stock),
          is_active     = COALESCE(v_active, is_active),
          updated_at    = now()
        WHERE id = v_existing.id;
        v_product_id := v_existing.id;
        v_action := 'updated';
      ELSE
        INSERT INTO public.products (
          store_id, external_id, sku, barcode, name, brand, model, category_id,
          cost_price, sale_price, minimum_stock, on_hand, is_active
        ) VALUES (
          p_store_id, v_ext, v_sku, v_barcode, v_name, v_brand, v_model, v_category_id,
          COALESCE(v_cost, 0), COALESCE(v_price, 0), COALESCE(v_min, 0), COALESCE(v_stock, 0),
          COALESCE(v_active, true)
        )
        RETURNING id INTO v_product_id;

        IF COALESCE(v_stock, 0) > 0 THEN
          INSERT INTO public.stock_movements (
            store_id, product_id, movement_type, qty, unit_cost, reason,
            reference_type, reference_id, created_by
          ) VALUES (
            p_store_id, v_product_id, 'initial_stock', v_stock, COALESCE(v_cost, 0),
            'Estoque inicial via API Pixel', 'pixel_sync', v_product_id, NULL
          );
        END IF;
        v_action := 'created';
      END IF;

      IF v_action = 'created' THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
      v_results := v_results || jsonb_build_object(
        'external_id', v_ext, 'action', v_action, 'product_id', v_product_id
      );

    EXCEPTION WHEN others THEN
      v_errors := v_errors + 1;
      v_results := v_results || jsonb_build_object(
        'external_id', v_ext, 'action', 'error', 'error', SQLERRM
      );
    END;
  END LOOP;

  -- Até 50 erros com o motivo, para a tela de Estokfy Pixel mostrar o que falhou.
  SELECT coalesce(jsonb_agg(s.item), '[]'::jsonb) INTO v_error_sample
  FROM (
    SELECT jsonb_build_object('external_id', r->'external_id', 'error', r->'error') AS item
    FROM jsonb_array_elements(v_results) r
    WHERE r->>'action' = 'error'
    LIMIT 50
  ) s;

  INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (
    p_store_id, NULL, 'pixel_products_sync', 'product', NULL,
    jsonb_build_object(
      'created', v_created, 'updated', v_updated, 'errors', v_errors,
      'items', jsonb_array_length(p_products), 'errors_detail', v_error_sample
    )
  );

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'errors',  v_errors,
    'results', v_results
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pixel_sync_products(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pixel_sync_products(uuid, jsonb) TO service_role;
