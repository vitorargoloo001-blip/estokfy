
-- 1) Restrict store_pixels SELECT to owner/admin (secret_key exposure)
DROP POLICY IF EXISTS pixels_select ON public.store_pixels;
CREATE POLICY pixels_select ON public.store_pixels
  FOR SELECT TO authenticated
  USING (store_id = get_my_store_id() AND get_my_role() = ANY (ARRAY['owner','admin']));

-- 2) Prevent privilege escalation via profiles INSERT (managers can't create owner/admin)
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = get_my_store_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','manager'])
    AND (
      role NOT IN ('owner','admin')
      OR get_my_role() = 'owner'
    )
  );

-- 3) Prevent privilege escalation via profiles UPDATE
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    store_id = get_my_store_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','manager'])
  )
  WITH CHECK (
    store_id = get_my_store_id()
    AND (
      role NOT IN ('owner','admin')
      OR get_my_role() = 'owner'
    )
  );

-- 4) Revoke anon EXECUTE from SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.can_delete_employee(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_financial_report_summary(uuid, date, date, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_delete_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_financial_report_summary(uuid, date, date, uuid) TO authenticated;
