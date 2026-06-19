-- Fix: Correct email lookup in connect_licenses RPCs
-- profiles table doesn't have email field; must join with auth.users

-- Fix RPC: list_connect_licenses
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
    u.email,
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
  LEFT JOIN auth.users u ON p.auth_user_id = u.id
  WHERE (p_status IS NULL OR cl.status = p_status)
    AND (p_plan_type IS NULL OR cl.plan_type = p_plan_type)
  ORDER BY cl.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix RPC: get_expiring_licenses
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
    u.email,
    cl.plan_type,
    cl.expires_at,
    EXTRACT(DAY FROM (cl.expires_at - now()))::INT,
    cl.amount_paid
  FROM connect_licenses cl
  LEFT JOIN stores s ON cl.store_id = s.id
  LEFT JOIN profiles p ON p.store_id = s.id AND p.role = 'owner'
  LEFT JOIN auth.users u ON p.auth_user_id = u.id
  WHERE cl.status = 'active'
    AND cl.expires_at > now()
    AND cl.expires_at <= now() + (p_days || ' days')::INTERVAL
  ORDER BY cl.expires_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
