-- Pluggy Integration Setup
-- Adds provider support and webhook tracking

-- Update bank_connections table with Pluggy-specific fields
-- (PostgreSQL: one ADD COLUMN per column; IF NOT EXISTS keeps it idempotent.
--  last_sync_at already exists from the bank_connections migration, so it is omitted.)
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'pluggy';
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS provider_connection_id TEXT UNIQUE;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'synced', 'failed'));
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS webhook_subscribed BOOLEAN DEFAULT false;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS webhook_id TEXT;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Indexes for performance
CREATE INDEX idx_bank_connections_provider ON bank_connections(provider);
CREATE INDEX idx_bank_connections_provider_connection_id ON bank_connections(provider_connection_id);
CREATE INDEX idx_bank_connections_sync_status ON bank_connections(sync_status);
CREATE INDEX idx_bank_connections_webhook_id ON bank_connections(webhook_id);

-- Provider Webhooks Event Log Table
CREATE TABLE provider_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  bank_connection_id UUID REFERENCES bank_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  webhook_id TEXT,
  payload JSONB NOT NULL,
  webhook_signature TEXT,
  processed BOOLEAN DEFAULT false,
  processing_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  processed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_provider_webhooks_store_id ON provider_webhooks(store_id);
CREATE INDEX idx_provider_webhooks_bank_connection_id ON provider_webhooks(bank_connection_id);
CREATE INDEX idx_provider_webhooks_event_type ON provider_webhooks(event_type);
CREATE INDEX idx_provider_webhooks_processed ON provider_webhooks(processed);
CREATE INDEX idx_provider_webhooks_created_at ON provider_webhooks(created_at DESC);

-- Enable RLS
ALTER TABLE provider_webhooks ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only authenticated users can view webhook events from their store
CREATE POLICY "Users can view webhook events from their store"
  ON provider_webhooks FOR SELECT
  TO authenticated
  USING (
    store_id = public.get_my_store_id()
    AND public.get_my_role() IN ('owner','admin','manager','finance')
  );

-- RLS Policy: Service role can insert webhook events
CREATE POLICY "Service role can insert webhook events"
  ON provider_webhooks FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- RLS Policy: Service role can update webhook events (mark as processed)
CREATE POLICY "Service role can update webhook events"
  ON provider_webhooks FOR UPDATE
  USING (auth.role() = 'service_role');

-- Function to log provider webhook events
CREATE OR REPLACE FUNCTION store_provider_webhook(
  p_store_id UUID,
  p_bank_connection_id UUID,
  p_provider TEXT,
  p_event_type TEXT,
  p_webhook_id TEXT,
  p_payload JSONB,
  p_signature TEXT
) RETURNS UUID AS $$
DECLARE
  v_webhook_id UUID;
BEGIN
  INSERT INTO provider_webhooks (
    store_id,
    bank_connection_id,
    provider,
    event_type,
    webhook_id,
    payload,
    webhook_signature
  ) VALUES (
    p_store_id,
    p_bank_connection_id,
    p_provider,
    p_event_type,
    p_webhook_id,
    p_payload,
    p_signature
  ) RETURNING id INTO v_webhook_id;

  RETURN v_webhook_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update bank connection sync status
CREATE OR REPLACE FUNCTION update_bank_connection_sync(
  p_bank_connection_id UUID,
  p_sync_status TEXT,
  p_error_message TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE bank_connections
  SET
    sync_status = p_sync_status,
    last_sync_at = CASE WHEN p_sync_status = 'synced' THEN now() ELSE last_sync_at END,
    last_sync_error = p_error_message
  WHERE id = p_bank_connection_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Get bank connection with provider details
CREATE OR REPLACE FUNCTION get_bank_connection_with_provider(p_store_id UUID)
RETURNS TABLE (
  id UUID,
  store_id UUID,
  provider TEXT,
  provider_connection_id TEXT,
  bank_name TEXT,
  account_type TEXT,
  status TEXT,
  sync_status TEXT,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_sync_error TEXT,
  webhook_subscribed BOOLEAN,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bc.id,
    bc.store_id,
    bc.provider,
    bc.provider_connection_id,
    bc.bank_name,
    bc.account_type,
    bc.status,
    bc.sync_status,
    bc.last_sync_at,
    bc.last_sync_error,
    bc.webhook_subscribed,
    bc.token_expires_at,
    bc.created_at
  FROM bank_connections bc
  WHERE bc.store_id = p_store_id
  ORDER BY bc.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: List webhook events for a bank connection
CREATE OR REPLACE FUNCTION list_webhook_events(
  p_store_id UUID,
  p_bank_connection_id UUID DEFAULT NULL,
  p_event_type TEXT DEFAULT NULL,
  p_processed BOOLEAN DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  id UUID,
  event_type TEXT,
  processed BOOLEAN,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  processed_at TIMESTAMP WITH TIME ZONE,
  processing_error TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pw.id,
    pw.event_type,
    pw.processed,
    pw.payload,
    pw.created_at,
    pw.processed_at,
    pw.processing_error
  FROM provider_webhooks pw
  WHERE pw.store_id = p_store_id
    AND (p_bank_connection_id IS NULL OR pw.bank_connection_id = p_bank_connection_id)
    AND (p_event_type IS NULL OR pw.event_type = p_event_type)
    AND (p_processed IS NULL OR pw.processed = p_processed)
  ORDER BY pw.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Mark webhook as processed
CREATE OR REPLACE FUNCTION mark_webhook_processed(
  p_webhook_id UUID,
  p_success BOOLEAN,
  p_error_message TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE provider_webhooks
  SET
    processed = p_success,
    processing_error = CASE WHEN NOT p_success THEN p_error_message ELSE NULL END,
    processed_at = now()
  WHERE id = p_webhook_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION store_provider_webhook TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_bank_connection_sync TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_bank_connection_with_provider TO authenticated;
GRANT EXECUTE ON FUNCTION list_webhook_events TO authenticated;
GRANT EXECUTE ON FUNCTION mark_webhook_processed TO authenticated, service_role;
