
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

-- RPC: only owner can delete (deactivate) an employee profile. We don't hard-delete profile (FK risk via sales.created_by) — we mark inactive and clear role.
-- Actual auth.user removal is done in edge function with service role.
CREATE OR REPLACE FUNCTION public.can_delete_employee(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles me
    WHERE me.auth_user_id = auth.uid()
      AND me.role = 'owner'
      AND me.store_id = (SELECT store_id FROM public.profiles WHERE id = p_profile_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_profile_id AND p.role = 'owner'
  );
$$;
