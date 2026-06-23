-- Block 10: Multi-segmento — Estokfy Universal
-- Adds business_type to stores, set/get RPCs for tenant and super admin

-- ─── 1. business_type column ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'business_type'
  ) THEN
    ALTER TABLE public.stores
    ADD COLUMN business_type TEXT NOT NULL DEFAULT 'retail';
  END IF;
END $$;

-- Add CHECK constraint if not already present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'business_type'
    AND constraint_name = 'stores_business_type_check'
  ) THEN
    ALTER TABLE public.stores
    ADD CONSTRAINT stores_business_type_check
    CHECK (business_type IN (
      'technical_assistance', 'retail', 'distributor', 'services',
      'fashion', 'food', 'auto_parts', 'pet_shop', 'market',
      'optical', 'stationery', 'custom'
    ));
  END IF;
END $$;

-- ─── 2. RPC: owner/admin sets own store business_type ────────────────────
CREATE OR REPLACE FUNCTION set_store_business_type(
  p_store_id    UUID,
  p_business_type TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := get_my_role();
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'access denied: owner or admin required';
  END IF;
  IF get_my_store_id() != p_store_id THEN
    RAISE EXCEPTION 'store mismatch';
  END IF;
  IF p_business_type NOT IN (
    'technical_assistance', 'retail', 'distributor', 'services',
    'fashion', 'food', 'auto_parts', 'pet_shop', 'market',
    'optical', 'stationery', 'custom'
  ) THEN
    RAISE EXCEPTION 'invalid business_type: %', p_business_type;
  END IF;
  UPDATE public.stores SET business_type = p_business_type WHERE id = p_store_id;
END;
$$;

REVOKE ALL ON FUNCTION set_store_business_type(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION set_store_business_type(UUID, TEXT) TO authenticated;

-- ─── 3. RPC: super admin sets any store's business_type ──────────────────
CREATE OR REPLACE FUNCTION super_admin_set_business_type(
  p_store_id      UUID,
  p_business_type TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email != 'vitorargoloo001@gmail.com' THEN
    RAISE EXCEPTION 'super admin only';
  END IF;
  IF p_business_type NOT IN (
    'technical_assistance', 'retail', 'distributor', 'services',
    'fashion', 'food', 'auto_parts', 'pet_shop', 'market',
    'optical', 'stationery', 'custom'
  ) THEN
    RAISE EXCEPTION 'invalid business_type: %', p_business_type;
  END IF;
  UPDATE public.stores SET business_type = p_business_type WHERE id = p_store_id;
END;
$$;

REVOKE ALL ON FUNCTION super_admin_set_business_type(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION super_admin_set_business_type(UUID, TEXT) TO authenticated;
