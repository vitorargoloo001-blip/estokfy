
-- 1. Add purchase metadata columns to stock_movements
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS total_amount numeric;

CREATE INDEX IF NOT EXISTS idx_stock_movements_store_type_date
  ON public.stock_movements (store_id, movement_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_supplier
  ON public.stock_movements (supplier_id);

-- 2. Create private bucket for purchase receipts (NF photos / PDFs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('purchase-receipts', 'purchase-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS policies on storage.objects for the bucket
-- Path convention: <store_id>/<filename>
DROP POLICY IF EXISTS "purchase_receipts_select" ON storage.objects;
CREATE POLICY "purchase_receipts_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'purchase-receipts'
  AND (storage.foldername(name))[1] = public.get_my_store_id()::text
);

DROP POLICY IF EXISTS "purchase_receipts_insert" ON storage.objects;
CREATE POLICY "purchase_receipts_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'purchase-receipts'
  AND (storage.foldername(name))[1] = public.get_my_store_id()::text
  AND public.get_my_role() = ANY (ARRAY['owner','admin','manager','stock'])
);

DROP POLICY IF EXISTS "purchase_receipts_update" ON storage.objects;
CREATE POLICY "purchase_receipts_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'purchase-receipts'
  AND (storage.foldername(name))[1] = public.get_my_store_id()::text
  AND public.get_my_role() = ANY (ARRAY['owner','admin','manager','stock'])
);

DROP POLICY IF EXISTS "purchase_receipts_delete" ON storage.objects;
CREATE POLICY "purchase_receipts_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'purchase-receipts'
  AND (storage.foldername(name))[1] = public.get_my_store_id()::text
  AND public.get_my_role() = ANY (ARRAY['owner','admin','manager'])
);

-- 4. Add 'Compra de Estoque' to finance expense categories in existing stores
UPDATE public.store_settings
SET settings = jsonb_set(
  settings,
  '{categories_expense}',
  CASE
    WHEN settings->'categories_expense' IS NULL THEN '["Compra de Estoque"]'::jsonb
    WHEN NOT (settings->'categories_expense' ? 'Compra de Estoque')
      THEN (settings->'categories_expense') || '["Compra de Estoque"]'::jsonb
    ELSE settings->'categories_expense'
  END
)
WHERE category = 'finance';
