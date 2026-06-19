
CREATE TABLE public.store_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  category text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  UNIQUE(store_id, category)
);

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_store_settings_lookup ON public.store_settings(store_id, category);

CREATE POLICY "store_settings_select" ON public.store_settings FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());

CREATE POLICY "store_settings_insert" ON public.store_settings FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() IN ('owner','admin'));

CREATE POLICY "store_settings_update" ON public.store_settings FOR UPDATE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() IN ('owner','admin'));

-- Also add extra columns to stores for the store data tab
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS state_registration text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#3B82F6',
  ADD COLUMN IF NOT EXISTS secondary_color text DEFAULT '#1E40AF';

-- Allow owner/admin to update store info
CREATE POLICY "stores_update" ON public.stores FOR UPDATE TO authenticated
  USING (id = get_my_store_id() AND get_my_role() IN ('owner','admin'));
