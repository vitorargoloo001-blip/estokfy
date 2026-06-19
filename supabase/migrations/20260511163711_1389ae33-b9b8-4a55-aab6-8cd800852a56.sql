CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_unique
ON public.products (store_id, barcode)
WHERE barcode IS NOT NULL AND length(btrim(barcode)) > 0;