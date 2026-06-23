
-- =====================================================
-- OS PRO — Ordem de Serviço Universal
-- Additive migration: no breaking changes to existing data
-- =====================================================

-- -------------------------------------------------------
-- 1) ADD PRO columns to service_orders
-- -------------------------------------------------------
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS is_pro boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_days integer,
  ADD COLUMN IF NOT EXISTS warranty_description text,
  ADD COLUMN IF NOT EXISTS travel_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toll_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS km_driven numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS km_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_costs numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_costs_desc text,
  ADD COLUMN IF NOT EXISTS executed_services_notes text,
  ADD COLUMN IF NOT EXISTS technician_signature_url text,
  ADD COLUMN IF NOT EXISTS client_signature_url text;

-- -------------------------------------------------------
-- 2) ADD photo_type to service_order_photos
-- -------------------------------------------------------
ALTER TABLE public.service_order_photos
  ADD COLUMN IF NOT EXISTS photo_type text NOT NULL DEFAULT 'other',
  ADD CONSTRAINT sop_photo_type_chk CHECK (photo_type IN ('before','after','other'));

-- -------------------------------------------------------
-- 3) TABLE: service_order_equipment (multiple per OS)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_order_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  device text NOT NULL,
  brand text,
  model text,
  serial_number text,
  inventory_number text,
  condition text,
  accessories text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soe_os ON public.service_order_equipment(service_order_id);
CREATE INDEX IF NOT EXISTS idx_soe_store ON public.service_order_equipment(store_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_order_equipment TO authenticated;
GRANT ALL ON public.service_order_equipment TO service_role;
ALTER TABLE public.service_order_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY soe_select ON public.service_order_equipment FOR SELECT TO authenticated
  USING (store_id = get_my_store_id());
CREATE POLICY soe_insert ON public.service_order_equipment FOR INSERT TO authenticated
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager','sales','stock']));
CREATE POLICY soe_update ON public.service_order_equipment FOR UPDATE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager','sales','stock']))
  WITH CHECK (store_id = get_my_store_id());
CREATE POLICY soe_delete ON public.service_order_equipment FOR DELETE TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin','manager','stock']));

-- -------------------------------------------------------
-- 4) UPDATE so_recalc_totals to include extra costs
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.so_recalc_totals(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_labor   numeric := 0;
  v_parts   numeric := 0;
  v_disc    numeric := 0;
  v_paid    numeric := 0;
  v_travel  numeric := 0;
  v_toll    numeric := 0;
  v_km      numeric := 0;
  v_km_rate numeric := 0;
  v_other   numeric := 0;
  v_total   numeric := 0;
BEGIN
  SELECT COALESCE(SUM(total) FILTER (WHERE item_type='service'),0),
         COALESCE(SUM(total) FILTER (WHERE item_type='part'),0)
    INTO v_labor, v_parts
    FROM service_order_items WHERE service_order_id = p_id;

  SELECT discount,
         COALESCE(travel_cost,0), COALESCE(toll_cost,0),
         COALESCE(km_driven,0), COALESCE(km_rate,0),
         COALESCE(other_costs,0),
         COALESCE((SELECT SUM(amount) FROM service_order_payments WHERE service_order_id = p_id),0)
    INTO v_disc, v_travel, v_toll, v_km, v_km_rate, v_other, v_paid
    FROM service_orders WHERE id = p_id;

  v_total := GREATEST(
    v_labor + v_parts + v_travel + v_toll + (v_km * v_km_rate) + v_other - COALESCE(v_disc,0),
    0
  );

  UPDATE service_orders
    SET labor_amount  = v_labor,
        parts_amount  = v_parts,
        total_amount  = v_total,
        paid_amount   = v_paid,
        pending_amount = GREATEST(v_total - v_paid, 0)
    WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_recalc_totals(uuid) TO authenticated;

-- -------------------------------------------------------
-- 5) RPC: so_add_equipment
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.so_add_equipment(
  p_os      uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role  text := get_my_role();
  v_id    uuid;
  v_sort  integer;
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(MAX(sort_order),0) + 1 INTO v_sort
    FROM service_order_equipment WHERE service_order_id = p_os AND store_id = v_store;

  INSERT INTO service_order_equipment (
    store_id, service_order_id,
    device, brand, model, serial_number, inventory_number, condition, accessories, sort_order
  ) VALUES (
    v_store, p_os,
    p_payload->>'device',
    NULLIF(p_payload->>'brand',''),
    NULLIF(p_payload->>'model',''),
    NULLIF(p_payload->>'serial_number',''),
    NULLIF(p_payload->>'inventory_number',''),
    NULLIF(p_payload->>'condition',''),
    NULLIF(p_payload->>'accessories',''),
    v_sort
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_add_equipment(uuid, jsonb) TO authenticated;

-- -------------------------------------------------------
-- 6) RPC: so_remove_equipment
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.so_remove_equipment(p_eq_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role  text := get_my_role();
BEGIN
  IF v_role NOT IN ('owner','admin','manager','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM service_order_equipment WHERE id = p_eq_id AND store_id = v_store;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_remove_equipment(uuid) TO authenticated;

-- -------------------------------------------------------
-- 7) RPC: so_update_signatures
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.so_update_signatures(
  p_os           uuid,
  p_tech_sig     text,
  p_client_sig   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role  text := get_my_role();
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE service_orders
    SET technician_signature_url = p_tech_sig,
        client_signature_url     = p_client_sig
    WHERE id = p_os AND store_id = v_store;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_update_signatures(uuid, text, text) TO authenticated;

-- -------------------------------------------------------
-- 8) RPC: so_update_warranty
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.so_update_warranty(
  p_os          uuid,
  p_days        integer,
  p_description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role  text := get_my_role();
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE service_orders
    SET warranty_days        = p_days,
        warranty_description = p_description
    WHERE id = p_os AND store_id = v_store;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_update_warranty(uuid, integer, text) TO authenticated;

-- -------------------------------------------------------
-- 9) RPC: so_update_extra_costs
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.so_update_extra_costs(
  p_os         uuid,
  p_travel     numeric,
  p_toll       numeric,
  p_km         numeric,
  p_km_rate    numeric,
  p_other      numeric,
  p_other_desc text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role  text := get_my_role();
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE service_orders
    SET travel_cost    = COALESCE(p_travel,0),
        toll_cost      = COALESCE(p_toll,0),
        km_driven      = COALESCE(p_km,0),
        km_rate        = COALESCE(p_km_rate,0),
        other_costs    = COALESCE(p_other,0),
        other_costs_desc = p_other_desc
    WHERE id = p_os AND store_id = v_store;
  PERFORM so_recalc_totals(p_os);
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_update_extra_costs(uuid, numeric, numeric, numeric, numeric, numeric, text) TO authenticated;

-- -------------------------------------------------------
-- 10) RPC: so_update_executed_notes
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.so_update_executed_notes(
  p_os    uuid,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_role  text := get_my_role();
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE service_orders
    SET executed_services_notes = p_notes
    WHERE id = p_os AND store_id = v_store;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_update_executed_notes(uuid, text) TO authenticated;

-- -------------------------------------------------------
-- 11) RPC: so_add_photo_pro (with photo_type)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.so_add_photo_pro(
  p_os           uuid,
  p_storage_path text,
  p_caption      text,
  p_photo_type   text  -- 'before' | 'after' | 'other'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store   uuid := get_my_store_id();
  v_role    text := get_my_role();
  v_user    uuid := auth.uid();
  v_profile uuid;
  v_id      uuid;
BEGIN
  IF v_role NOT IN ('owner','admin','manager','sales','stock') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO v_profile FROM profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  INSERT INTO service_order_photos (store_id, service_order_id, storage_path, caption, photo_type, created_by)
  VALUES (v_store, p_os, p_storage_path, p_caption, COALESCE(p_photo_type,'other'), v_profile)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.so_add_photo_pro(uuid, text, text, text) TO authenticated;

-- -------------------------------------------------------
-- 12) Storage bucket for OS photos (idempotent)
-- -------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'service-order-photos',
  'service-order-photos',
  true,
  10485760,  -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for the bucket (drop-if-exists then recreate)
DROP POLICY IF EXISTS "OS photos — store members can upload" ON storage.objects;
CREATE POLICY "OS photos — store members can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'service-order-photos'
    AND get_my_role() = ANY (ARRAY['owner','admin','manager','sales','stock'])
  );

DROP POLICY IF EXISTS "OS photos — store members can read" ON storage.objects;
CREATE POLICY "OS photos — store members can read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'service-order-photos');

DROP POLICY IF EXISTS "OS photos — admins can delete" ON storage.objects;
CREATE POLICY "OS photos — admins can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'service-order-photos'
    AND get_my_role() = ANY (ARRAY['owner','admin','manager'])
  );
