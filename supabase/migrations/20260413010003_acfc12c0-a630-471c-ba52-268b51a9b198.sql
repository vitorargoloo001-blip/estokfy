
-- 1. Create system_admins table
CREATE TABLE public.system_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_admins ENABLE ROW LEVEL SECURITY;

-- Only super admins can see this table
CREATE POLICY "sa_select" ON public.system_admins FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.system_admins sa
    JOIN auth.users u ON lower(u.email) = lower(sa.email)
    WHERE u.id = auth.uid() AND sa.is_active = true
  ));

-- 2. Seed the master super admin
INSERT INTO public.system_admins (email) VALUES ('vitorargoloo001@gmail.com');

-- 3. Add SaaS control columns to stores
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS access_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text;

-- 4. Security definer function: is current user a super admin?
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.system_admins sa
    JOIN auth.users u ON lower(u.email) = lower(sa.email)
    WHERE u.id = auth.uid() AND sa.is_active = true
  )
$$;

-- 5. Security definer function: check if a store has access
CREATE OR REPLACE FUNCTION public.check_store_access(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.access_enabled AND s.subscription_status NOT IN ('suspended','blocked','inactive')
     FROM public.stores s WHERE s.id = p_store_id),
    false
  )
$$;

-- 6. Allow super admin to SELECT all stores
CREATE POLICY "sa_stores_select" ON public.stores FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- 7. Allow super admin to UPDATE all stores
CREATE POLICY "sa_stores_update" ON public.stores FOR UPDATE TO authenticated
  USING (public.is_super_admin());

-- 8. Allow super admin to SELECT all profiles (cross-store)
CREATE POLICY "sa_profiles_select" ON public.profiles FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- 9. Super admin audit logs
CREATE TABLE public.super_admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  store_id uuid REFERENCES public.stores(id),
  action text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.super_admin_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sa_logs_select" ON public.super_admin_logs FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "sa_logs_insert" ON public.super_admin_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());
