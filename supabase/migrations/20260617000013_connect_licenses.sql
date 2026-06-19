-- Connect Licenses Table
CREATE TABLE connect_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('starter', 'professional', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  contracted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  amount_paid DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'BRL',
  suspended_at TIMESTAMP WITH TIME ZONE,
  suspended_by UUID REFERENCES auth.users(id),
  suspension_reason TEXT,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  cancelled_by UUID REFERENCES auth.users(id),
  cancellation_reason TEXT,
  auto_renew BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_connect_licenses_store_id ON connect_licenses(store_id);
CREATE INDEX idx_connect_licenses_status ON connect_licenses(status);
CREATE INDEX idx_connect_licenses_plan_type ON connect_licenses(plan_type);
CREATE INDEX idx_connect_licenses_expires_at ON connect_licenses(expires_at);
CREATE INDEX idx_connect_licenses_created_at ON connect_licenses(created_at DESC);

-- Enable RLS
ALTER TABLE connect_licenses ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only master user (vitorargoloo001@gmail.com) can view
CREATE POLICY "Master user can view all connect licenses"
  ON connect_licenses FOR SELECT
  USING (
    auth.jwt()->>'email' = 'vitorargoloo001@gmail.com'
  );

-- RLS Policy: Only master user can insert
CREATE POLICY "Master user can insert connect licenses"
  ON connect_licenses FOR INSERT
  WITH CHECK (
    auth.jwt()->>'email' = 'vitorargoloo001@gmail.com'
  );

-- RLS Policy: Only master user can update
CREATE POLICY "Master user can update connect licenses"
  ON connect_licenses FOR UPDATE
  USING (
    auth.jwt()->>'email' = 'vitorargoloo001@gmail.com'
  );

-- RLS Policy: Only master user can delete
CREATE POLICY "Master user can delete connect licenses"
  ON connect_licenses FOR DELETE
  USING (
    auth.jwt()->>'email' = 'vitorargoloo001@gmail.com'
  );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_connect_licenses_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER connect_licenses_updated_at
  BEFORE UPDATE ON connect_licenses
  FOR EACH ROW
  EXECUTE FUNCTION update_connect_licenses_timestamp();

-- RPC: List all connect licenses with filter
CREATE OR REPLACE FUNCTION list_connect_licenses(
  p_status TEXT DEFAULT NULL,
  p_plan_type TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  id UUID,
  store_id UUID,
  store_name TEXT,
  owner_email TEXT,
  plan_type TEXT,
  status TEXT,
  contracted_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  amount_paid DECIMAL,
  currency TEXT,
  suspended_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  auto_renew BOOLEAN,
  days_until_expiry INT,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cl.id,
    cl.store_id,
    COALESCE(s.trade_name, s.name),
    pu.email,
    cl.plan_type,
    cl.status,
    cl.contracted_at,
    cl.expires_at,
    cl.amount_paid,
    cl.currency,
    cl.suspended_at,
    cl.cancelled_at,
    cl.auto_renew,
    EXTRACT(DAY FROM (cl.expires_at - now()))::INT,
    cl.created_at
  FROM connect_licenses cl
  LEFT JOIN stores s ON cl.store_id = s.id
  LEFT JOIN profiles p ON p.store_id = s.id AND p.role = 'owner'
  LEFT JOIN auth.users pu ON pu.id = p.auth_user_id
  WHERE (p_status IS NULL OR cl.status = p_status)
    AND (p_plan_type IS NULL OR cl.plan_type = p_plan_type)
  ORDER BY cl.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Get license by store_id
CREATE OR REPLACE FUNCTION get_connect_license(p_store_id UUID)
RETURNS TABLE (
  id UUID,
  store_id UUID,
  store_name TEXT,
  owner_email TEXT,
  plan_type TEXT,
  status TEXT,
  contracted_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  amount_paid DECIMAL,
  currency TEXT,
  suspended_at TIMESTAMP WITH TIME ZONE,
  suspended_by TEXT,
  suspension_reason TEXT,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  cancelled_by TEXT,
  cancellation_reason TEXT,
  auto_renew BOOLEAN,
  days_until_expiry INT,
  is_expired BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cl.id,
    cl.store_id,
    COALESCE(s.trade_name, s.name),
    pu.email,
    cl.plan_type,
    cl.status,
    cl.contracted_at,
    cl.expires_at,
    cl.amount_paid,
    cl.currency,
    cl.suspended_at,
    spu.email,
    cl.suspension_reason,
    cl.cancelled_at,
    cpu.email,
    cl.cancellation_reason,
    cl.auto_renew,
    EXTRACT(DAY FROM (cl.expires_at - now()))::INT,
    cl.expires_at < now(),
    cl.created_at
  FROM connect_licenses cl
  LEFT JOIN stores s ON cl.store_id = s.id
  LEFT JOIN profiles p ON p.store_id = s.id AND p.role = 'owner'
  LEFT JOIN auth.users pu ON pu.id = p.auth_user_id
  LEFT JOIN auth.users sp ON cl.suspended_by = sp.id
  LEFT JOIN auth.users cp ON cl.cancelled_by = cp.id
  WHERE cl.store_id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Activate license
CREATE OR REPLACE FUNCTION activate_connect_license(p_license_id UUID)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  new_status TEXT
) AS $$
DECLARE
  v_license_id UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN QUERY SELECT false, 'Apenas o administrador master pode gerenciar licenças'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE connect_licenses
  SET
    status = 'active',
    suspended_at = NULL,
    suspended_by = NULL,
    suspension_reason = NULL
  WHERE id = p_license_id
  RETURNING id INTO v_license_id;

  IF v_license_id IS NOT NULL THEN
    RETURN QUERY SELECT true, 'Licença ativada com sucesso'::TEXT, 'active'::TEXT;
  ELSE
    RETURN QUERY SELECT false, 'Licença não encontrada'::TEXT, NULL::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Suspend license
CREATE OR REPLACE FUNCTION suspend_connect_license(
  p_license_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  new_status TEXT
) AS $$
DECLARE
  v_license_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF NOT public.is_super_admin() THEN
    RETURN QUERY SELECT false, 'Apenas o administrador master pode gerenciar licenças'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE connect_licenses
  SET
    status = 'suspended',
    suspended_at = now(),
    suspended_by = v_user_id,
    suspension_reason = p_reason
  WHERE id = p_license_id
  RETURNING id INTO v_license_id;

  IF v_license_id IS NOT NULL THEN
    RETURN QUERY SELECT true, 'Licença suspensa com sucesso'::TEXT, 'suspended'::TEXT;
  ELSE
    RETURN QUERY SELECT false, 'Licença não encontrada'::TEXT, NULL::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Cancel license
CREATE OR REPLACE FUNCTION cancel_connect_license(
  p_license_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  new_status TEXT
) AS $$
DECLARE
  v_license_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF NOT public.is_super_admin() THEN
    RETURN QUERY SELECT false, 'Apenas o administrador master pode gerenciar licenças'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE connect_licenses
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_user_id,
    cancellation_reason = p_reason,
    auto_renew = false
  WHERE id = p_license_id
  RETURNING id INTO v_license_id;

  IF v_license_id IS NOT NULL THEN
    RETURN QUERY SELECT true, 'Licença cancelada com sucesso'::TEXT, 'cancelled'::TEXT;
  ELSE
    RETURN QUERY SELECT false, 'Licença não encontrada'::TEXT, NULL::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Get license statistics
CREATE OR REPLACE FUNCTION get_connect_license_stats()
RETURNS TABLE (
  total_licenses BIGINT,
  active_count BIGINT,
  suspended_count BIGINT,
  cancelled_count BIGINT,
  expiring_soon BIGINT,
  total_revenue DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'active') as active,
    COUNT(*) FILTER (WHERE status = 'suspended') as suspended,
    COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
    COUNT(*) FILTER (WHERE status = 'active' AND expires_at <= now() + INTERVAL '7 days') as expiring,
    COALESCE(SUM(amount_paid) FILTER (WHERE status IN ('active', 'suspended')), 0) as revenue
  FROM connect_licenses;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Get licenses expiring in N days
CREATE OR REPLACE FUNCTION get_expiring_licenses(p_days INT DEFAULT 7)
RETURNS TABLE (
  id UUID,
  store_id UUID,
  store_name TEXT,
  owner_email TEXT,
  plan_type TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  days_until_expiry INT,
  amount_paid DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cl.id,
    cl.store_id,
    COALESCE(s.trade_name, s.name),
    pu.email,
    cl.plan_type,
    cl.expires_at,
    EXTRACT(DAY FROM (cl.expires_at - now()))::INT,
    cl.amount_paid
  FROM connect_licenses cl
  LEFT JOIN stores s ON cl.store_id = s.id
  LEFT JOIN profiles p ON p.store_id = s.id AND p.role = 'owner'
  LEFT JOIN auth.users pu ON pu.id = p.auth_user_id
  WHERE cl.status = 'active'
    AND cl.expires_at > now()
    AND cl.expires_at <= now() + (p_days || ' days')::INTERVAL
  ORDER BY cl.expires_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION list_connect_licenses TO authenticated;
GRANT EXECUTE ON FUNCTION get_connect_license TO authenticated;
GRANT EXECUTE ON FUNCTION activate_connect_license TO authenticated;
GRANT EXECUTE ON FUNCTION suspend_connect_license TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_connect_license TO authenticated;
GRANT EXECUTE ON FUNCTION get_connect_license_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_expiring_licenses TO authenticated;
