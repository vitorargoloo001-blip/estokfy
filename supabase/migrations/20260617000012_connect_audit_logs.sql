-- Connect Audit Logs Table
CREATE TABLE connect_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at_date DATE GENERATED ALWAYS AS (DATE(created_at AT TIME ZONE 'America/Sao_Paulo')) STORED
);

-- Indexes for performance
CREATE INDEX idx_connect_audit_logs_store_id ON connect_audit_logs(store_id);
CREATE INDEX idx_connect_audit_logs_user_id ON connect_audit_logs(user_id);
CREATE INDEX idx_connect_audit_logs_created_at ON connect_audit_logs(created_at DESC);
CREATE INDEX idx_connect_audit_logs_action_type ON connect_audit_logs(action_type);
CREATE INDEX idx_connect_audit_logs_store_created ON connect_audit_logs(store_id, created_at DESC);

-- Enable RLS
ALTER TABLE connect_audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: users can only see their store's audit logs
CREATE POLICY "Users can view own store audit logs"
  ON connect_audit_logs FOR SELECT
  TO authenticated
  USING (
    store_id = public.get_my_store_id()
    AND public.get_my_role() IN ('owner','admin','manager','finance')
  );

-- RLS Policy: service role (Edge Functions) can insert
CREATE POLICY "Service role can insert audit logs"
  ON connect_audit_logs FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Function to log Connect audit events
CREATE OR REPLACE FUNCTION log_connect_audit(
  p_store_id UUID,
  p_user_id UUID,
  p_action TEXT,
  p_action_type TEXT,
  p_entity_type TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  INSERT INTO connect_audit_logs (
    store_id,
    user_id,
    action,
    action_type,
    entity_type,
    entity_id,
    details,
    ip_address,
    user_agent
  ) VALUES (
    p_store_id,
    p_user_id,
    p_action,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_details,
    p_ip_address,
    p_user_agent
  ) RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: List audit logs with filters
CREATE OR REPLACE FUNCTION list_connect_audit_logs(
  p_store_id UUID,
  p_action_type TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  action TEXT,
  action_type TEXT,
  entity_type TEXT,
  entity_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  created_at_date DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cal.id,
    cal.user_id,
    COALESCE(p.full_name, au.email) AS user_email,
    cal.action,
    cal.action_type,
    cal.entity_type,
    cal.entity_id,
    cal.details,
    cal.ip_address,
    cal.created_at,
    cal.created_at_date
  FROM connect_audit_logs cal
  LEFT JOIN auth.users au ON cal.user_id = au.id
  LEFT JOIN profiles p ON p.auth_user_id = cal.user_id
  WHERE cal.store_id = p_store_id
    AND (p_action_type IS NULL OR cal.action_type = p_action_type)
    AND (p_entity_type IS NULL OR cal.entity_type = p_entity_type)
    AND (p_start_date IS NULL OR cal.created_at >= p_start_date)
    AND (p_end_date IS NULL OR cal.created_at <= p_end_date)
  ORDER BY cal.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Get audit log summary for dashboard
CREATE OR REPLACE FUNCTION get_connect_audit_summary(
  p_store_id UUID,
  p_days INT DEFAULT 30
) RETURNS TABLE (
  action_type TEXT,
  count BIGINT,
  last_occurrence TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cal.action_type,
    COUNT(*) as count,
    MAX(cal.created_at) as last_occurrence
  FROM connect_audit_logs cal
  WHERE cal.store_id = p_store_id
    AND cal.created_at >= now() - (p_days || ' days')::INTERVAL
  GROUP BY cal.action_type
  ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Count audit logs by action type and date for chart
CREATE OR REPLACE FUNCTION get_audit_timeline(
  p_store_id UUID,
  p_days INT DEFAULT 30
) RETURNS TABLE (
  date DATE,
  login BIGINT,
  sync BIGINT,
  reconciliation BIGINT,
  update_op BIGINT,
  delete_op BIGINT,
  reprocess BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cal.created_at_date,
    COUNT(*) FILTER (WHERE cal.action_type = 'login') as login,
    COUNT(*) FILTER (WHERE cal.action_type = 'sync') as sync,
    COUNT(*) FILTER (WHERE cal.action_type = 'reconciliation') as reconciliation,
    COUNT(*) FILTER (WHERE cal.action_type = 'update') as update_op,
    COUNT(*) FILTER (WHERE cal.action_type = 'delete') as delete_op,
    COUNT(*) FILTER (WHERE cal.action_type = 'reprocess') as reprocess
  FROM connect_audit_logs cal
  WHERE cal.store_id = p_store_id
    AND cal.created_at >= now() - (p_days || ' days')::INTERVAL
  GROUP BY cal.created_at_date
  ORDER BY cal.created_at_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION log_connect_audit TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION list_connect_audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION get_connect_audit_summary TO authenticated;
GRANT EXECUTE ON FUNCTION get_audit_timeline TO authenticated;
