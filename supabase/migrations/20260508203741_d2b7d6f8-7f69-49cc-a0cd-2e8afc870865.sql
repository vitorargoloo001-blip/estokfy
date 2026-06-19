ALTER TABLE public.products ALTER COLUMN sku DROP NOT NULL;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_store_id_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_store_id_sku_key ON public.products (store_id, sku) WHERE sku IS NOT NULL AND sku <> '';