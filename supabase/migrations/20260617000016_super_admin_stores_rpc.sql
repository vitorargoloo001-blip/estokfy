-- Super Admin - Stores RPC
-- Allows master user (vitorargoloo001@gmail.com) to list all stores

CREATE OR REPLACE FUNCTION public.get_all_stores_for_admin()
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  plan TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  -- Mapped to the real production columns: stores has no business_name/is_active,
  -- so we expose trade_name/name as business_name and access_enabled as is_active.
  SELECT
    s.id,
    COALESCE(s.trade_name, s.name) AS business_name,
    s.plan,
    s.access_enabled AS is_active
  FROM public.stores s
  WHERE public.is_super_admin()
  ORDER BY s.created_at DESC;
$FUNC$;

-- Grant execute to authenticated users (check happens inside function)
GRANT EXECUTE ON FUNCTION public.get_all_stores_for_admin() TO authenticated;
