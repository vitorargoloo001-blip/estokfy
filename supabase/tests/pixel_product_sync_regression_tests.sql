-- Estokfy Pixel: sincronização de produtos (pixel_sync_products). Migration 20261103000001.
-- All fixtures and the function copy live in pg_temp. No production rows or
-- function definitions are changed. The transaction is rolled back at the end.
BEGIN;
CREATE TEMP TABLE sync_checks (label text, actual text, expected text);
DO $$
DECLARE
  t text; definition text;
  tables text[] := ARRAY['products','categories','stock_movements','audit_logs'];
BEGIN
  CREATE TEMP TABLE stores (id uuid PRIMARY KEY);
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE TEMP TABLE %I (LIKE public.%I INCLUDING ALL)', t, t);
  END LOOP;
  definition := pg_get_functiondef('public.pixel_sync_products(uuid,jsonb)'::regprocedure);
  definition := replace(definition, 'public.pixel_sync_products', 'pg_temp.pixel_sync_products');
  definition := replace(definition, 'public.stores', 'pg_temp.stores');
  FOREACH t IN ARRAY tables LOOP
    definition := replace(definition, 'public.' || t, 'pg_temp.' || t);
  END LOOP;
  EXECUTE definition;
END $$;

INSERT INTO pg_temp.stores(id) VALUES
('00000000-0000-0000-0000-0000000000a1'),
('00000000-0000-0000-0000-0000000000a2');

-- P0: produto antigo, sem vínculo com a loja online, com SKU 'SKU-OLD' e estoque 3.
-- Z2: produto da loja 2, com id 'EXT-Z' e estoque 7.
INSERT INTO pg_temp.products(id, store_id, sku, name, on_hand, sale_price) VALUES
('00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-0000000000a1','SKU-OLD','Antigo',3,5),
('00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-0000000000a2','SKU-Z','Loja 2 original',7,9);
UPDATE pg_temp.products SET external_id = 'EXT-Z' WHERE id = '00000000-0000-0000-0000-000000000b02';

DO $$
DECLARE
  s1 uuid := '00000000-0000-0000-0000-0000000000a1';
  s2 uuid := '00000000-0000-0000-0000-0000000000a2';
  r jsonb;
  err text;
BEGIN
  -- Lote 1: criação, variações como produtos separados, erros isolados por item.
  r := pg_temp.pixel_sync_products(s1, '[
    {"external_id":"EXT-A","name":"Camiseta Básica - P / Azul","sku":"CAM-P-AZ","barcode":"7890000000001","category":"Roupas","cost_price":20,"sale_price":59.9,"stock":5},
    {"external_id":"EXT-B","name":"Camiseta Básica - M / Azul","sku":"CAM-M-AZ","category":"  roupas ","sale_price":59.9,"stock":0,"minimum_stock":2},
    {"external_id":"","name":"Sem id","sku":"X1"},
    {"external_id":"EXT-D","name":"","sku":"X2"},
    {"external_id":"EXT-E","name":"Preço negativo","sale_price":-1},
    {"external_id":"EXT-F","name":"Estoque quebrado","stock":1.5},
    {"external_id":"EXT-OLD","name":"Antigo atualizado","sku":"SKU-OLD","sale_price":10,"stock":100},
    {"external_id":"EXT-H","name":"Usa SKU de outro produto","sku":"CAM-P-AZ"}
  ]'::jsonb);

  INSERT INTO sync_checks VALUES
    ('lote 1 criados', r->>'created', '2'),
    ('lote 1 atualizados', r->>'updated', '1'),
    ('lote 1 erros', r->>'errors', '5'),
    ('EXT-A entra com o estoque informado',
      (SELECT on_hand::text FROM pg_temp.products WHERE store_id=s1 AND external_id='EXT-A'), '5'),
    ('EXT-A tem movimento de estoque inicial',
      (SELECT count(*)::text || ' ' || min(movement_type) || ' ' || sum(qty)::text FROM pg_temp.stock_movements m
         JOIN pg_temp.products p ON p.id = m.product_id WHERE p.external_id='EXT-A'), '1 initial_stock 5'),
    ('EXT-B com estoque zero não gera movimento',
      (SELECT count(*)::text FROM pg_temp.stock_movements m JOIN pg_temp.products p ON p.id=m.product_id WHERE p.external_id='EXT-B'), '0'),
    ('categoria criada uma vez, sem diferenciar maiúsculas',
      (SELECT count(*)::text || ' ' || min(name) FROM pg_temp.categories WHERE store_id=s1), '1 Roupas'),
    ('EXT-A e EXT-B na mesma categoria',
      (SELECT (count(DISTINCT category_id) = 1 AND bool_and(category_id IS NOT NULL))::text FROM pg_temp.products WHERE external_id IN ('EXT-A','EXT-B')), 'true'),
    ('produto antigo ligado pelo SKU, estoque preservado',
      (SELECT external_id || ' ' || on_hand::text || ' ' || name || ' ' || sale_price::text FROM pg_temp.products WHERE id='00000000-0000-0000-0000-000000000b01'),
      'EXT-OLD 3 Antigo atualizado 10.00'),
    ('id vazio: erro explicado',
      (SELECT error FROM (SELECT jsonb_array_elements(r->'results')->>'error' AS error, jsonb_array_elements(r->'results')->>'action' AS action) x WHERE action='error' AND error LIKE 'external_id_obrigatorio%' LIMIT 1), 'external_id_obrigatorio'),
    ('nome vazio: erro explicado',
      (SELECT error FROM (SELECT jsonb_array_elements(r->'results')->>'error' AS error, jsonb_array_elements(r->'results')->>'action' AS action) x WHERE action='error' AND error LIKE 'nome_obrigatorio%' LIMIT 1), 'nome_obrigatorio'),
    ('preço negativo: erro explicado',
      (SELECT error FROM (SELECT jsonb_array_elements(r->'results')->>'error' AS error, jsonb_array_elements(r->'results')->>'action' AS action) x WHERE action='error' AND error LIKE 'preco_invalido%' LIMIT 1), 'preco_invalido'),
    ('SKU de outro produto da loja online: não sobrescreve',
      (SELECT error FROM (SELECT jsonb_array_elements(r->'results')->>'error' AS error, jsonb_array_elements(r->'results')->>'action' AS action) x WHERE action='error' AND error LIKE 'sku_ja_ligado%' LIMIT 1), 'sku_ja_ligado_a_outro_produto_da_loja_online'),
    ('auditoria do lote',
      (SELECT count(*)::text || ' ' || max(after_json->>'created') FROM pg_temp.audit_logs WHERE action='pixel_products_sync'), '1 2');

  -- Lote 2: reenvio dos mesmos produtos. Não duplica e não mexe no estoque.
  r := pg_temp.pixel_sync_products(s1, '[
    {"external_id":"EXT-A","name":"Camiseta Básica - P / Azul","sku":"CAM-P-AZ","sale_price":65,"stock":99},
    {"external_id":"EXT-B","name":"Camiseta Básica - M / Azul","sku":"CAM-M-AZ","sale_price":65}
  ]'::jsonb);

  INSERT INTO sync_checks VALUES
    ('reenvio: nada criado', r->>'created', '0'),
    ('reenvio: dois atualizados', r->>'updated', '2'),
    ('reenvio: preço atualizado',
      (SELECT sale_price::text FROM pg_temp.products WHERE external_id='EXT-A'), '65.00'),
    ('reenvio: estoque do Estokfy não muda',
      (SELECT on_hand::text FROM pg_temp.products WHERE external_id='EXT-A'), '5'),
    ('reenvio: sem movimento novo',
      (SELECT count(*)::text FROM pg_temp.stock_movements), '1'),
    ('reenvio: sem produto duplicado na loja 1',
      (SELECT count(*)::text FROM pg_temp.products WHERE store_id=s1), '3');

  -- Lote 3: código de barras já ligado a outro id da loja online.
  r := pg_temp.pixel_sync_products(s1, '[
    {"external_id":"EXT-BC","name":"Pelo código de barras","barcode":"7890000000001"},
    {"external_id":"EXT-NEW","name":"Produto novo com estoque","barcode":"7890000000555","stock":2}
  ]'::jsonb);

  INSERT INTO sync_checks VALUES
    ('barcode de outro produto: erro',
      (SELECT error FROM (SELECT jsonb_array_elements(r->'results')->>'error' AS error, jsonb_array_elements(r->'results')->>'action' AS action) x WHERE action='error' LIMIT 1), 'barcode_ja_ligado_a_outro_produto_da_loja_online'),
    ('barcode livre: cria o produto novo',
      (SELECT on_hand::text FROM pg_temp.products WHERE external_id='EXT-NEW'), '2');

  -- Lote 4: isolamento entre lojas. O mesmo id 'EXT-A' na loja 2 cria produto novo lá.
  r := pg_temp.pixel_sync_products(s2, '[
    {"external_id":"EXT-A","name":"Nome da loja 2","sku":"SKU-B2","stock":4}
  ]'::jsonb);

  INSERT INTO sync_checks VALUES
    ('loja 2: criado, não atualizou a loja 1', r->>'created', '1'),
    ('loja 1 intacta',
      (SELECT name FROM pg_temp.products WHERE store_id=s1 AND external_id='EXT-A'), 'Camiseta Básica - P / Azul'),
    ('loja 2 original intacta',
      (SELECT on_hand::text FROM pg_temp.products WHERE external_id='EXT-Z'), '7'),
    ('loja 2 com dois produtos',
      (SELECT count(*)::text FROM pg_temp.products WHERE store_id=s2), '2');

  -- Limites e loja inexistente.
  BEGIN
    r := pg_temp.pixel_sync_products(s1, (SELECT jsonb_agg(jsonb_build_object('external_id','L'||g,'name','Item '||g)) FROM generate_series(1,501) g));
    err := 'sem erro';
  EXCEPTION WHEN others THEN err := SQLERRM;
  END;
  INSERT INTO sync_checks VALUES ('lote acima de 500 é recusado', err, 'lote_grande_demais');

  BEGIN
    r := pg_temp.pixel_sync_products('00000000-0000-0000-0000-0000000000ff', '[]'::jsonb);
    err := 'sem erro';
  EXCEPTION WHEN others THEN err := SQLERRM;
  END;
  INSERT INTO sync_checks VALUES ('loja inexistente é recusada', err, 'store_invalida');
END $$;

DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(label || ': expected=' || expected || ', got=' || coalesce(actual,'null'), E'\n') INTO failures
  FROM sync_checks WHERE actual IS DISTINCT FROM expected;
  IF failures IS NOT NULL THEN RAISE EXCEPTION 'Pixel product sync regressions:%', E'\n' || failures; END IF;
END $$;
ROLLBACK;
SELECT 'Pixel product sync regressions passed; all fixtures rolled back' AS result;
