-- =====================================================================
-- Connect Block 5 — Saúde da conexão + logs de sistema
-- =====================================================================

-- ── 1. Tabela connect_system_logs ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.connect_system_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  log_type            TEXT NOT NULL CHECK (log_type IN (
                        'sync', 'webhook', 'error', 'reconnect',
                        'token_expired', 'info', 'match'
                      )),
  message             TEXT NOT NULL,
  details             JSONB DEFAULT '{}',
  bank_connection_id  UUID REFERENCES public.bank_connections(id) ON DELETE SET NULL,
  pluggy_item_id      UUID REFERENCES public.pluggy_items(id) ON DELETE SET NULL,
  severity            TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.connect_system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY connect_system_logs_store ON public.connect_system_logs
  FOR ALL USING (
    store_id IN (
      SELECT store_id FROM public.profiles WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_connect_system_logs_store
  ON public.connect_system_logs(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connect_system_logs_type
  ON public.connect_system_logs(store_id, log_type, created_at DESC);

-- ── 2. RPC: add_connect_log (service_role + authenticated) ───────────

CREATE OR REPLACE FUNCTION public.add_connect_log(
  p_store_id            UUID,
  p_log_type            TEXT,
  p_message             TEXT,
  p_details             JSONB     DEFAULT '{}',
  p_bank_connection_id  UUID      DEFAULT NULL,
  p_pluggy_item_id      UUID      DEFAULT NULL,
  p_severity            TEXT      DEFAULT 'info'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.connect_system_logs (
    store_id, log_type, message, details,
    bank_connection_id, pluggy_item_id, severity
  ) VALUES (
    p_store_id, p_log_type, p_message, p_details,
    p_bank_connection_id, p_pluggy_item_id, p_severity
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_connect_log(UUID, TEXT, TEXT, JSONB, UUID, UUID, TEXT)
  TO authenticated, service_role;

-- ── 3. RPC: get_connect_logs ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_connect_logs(
  p_store_id    UUID,
  p_log_type    TEXT    DEFAULT NULL,
  p_severity    TEXT    DEFAULT NULL,
  p_start_date  DATE    DEFAULT NULL,
  p_end_date    DATE    DEFAULT NULL,
  p_limit       INTEGER DEFAULT 100,
  p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE(
  id                  UUID,
  log_type            TEXT,
  message             TEXT,
  details             JSONB,
  severity            TEXT,
  bank_connection_id  UUID,
  bank_name           TEXT,
  pluggy_item_id      UUID,
  institution_name    TEXT,
  created_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.log_type,
    l.message,
    l.details,
    l.severity,
    l.bank_connection_id,
    bc.bank_name,
    l.pluggy_item_id,
    pi2.institution_name,
    l.created_at
  FROM public.connect_system_logs l
  LEFT JOIN public.bank_connections bc ON bc.id = l.bank_connection_id
  LEFT JOIN public.pluggy_items    pi2 ON pi2.id = l.pluggy_item_id
  WHERE l.store_id = p_store_id
    AND (p_log_type   IS NULL OR l.log_type  = p_log_type)
    AND (p_severity   IS NULL OR l.severity  = p_severity)
    AND (p_start_date IS NULL OR l.created_at >= p_start_date::TIMESTAMPTZ)
    AND (p_end_date   IS NULL OR l.created_at <  (p_end_date + 1)::TIMESTAMPTZ)
  ORDER BY l.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_connect_logs(UUID, TEXT, TEXT, DATE, DATE, INTEGER, INTEGER)
  TO authenticated;

-- ── 4. RPC: get_connection_health ─────────────────────────────────────
-- Retorna saúde detalhada de cada banco conectado

CREATE OR REPLACE FUNCTION public.get_connection_health(
  p_store_id UUID
)
RETURNS TABLE(
  bank_connection_id    UUID,
  bank_name             TEXT,
  institution_name      TEXT,
  account_number        TEXT,
  account_type          TEXT,
  connection_status     TEXT,
  pluggy_status         TEXT,
  last_synced_at        TIMESTAMPTZ,
  last_webhook_at       TIMESTAMPTZ,
  last_webhook_event    TEXT,
  total_transactions    BIGINT,
  pending_matches       BIGINT,
  divergent_count       BIGINT,
  error_code            TEXT,
  error_message         TEXT,
  has_token_error       BOOLEAN,
  has_sync_error        BOOLEAN,
  has_webhook_stale     BOOLEAN,
  days_since_sync       INTEGER,
  days_since_webhook    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    bc.id                            AS bank_connection_id,
    bc.bank_name,
    pi2.institution_name,
    bc.account_number,
    bc.account_type,
    bc.status                        AS connection_status,
    pi2.status                       AS pluggy_status,
    pi2.last_synced_at,
    -- último webhook recebido para este item
    (SELECT pw.received_at
     FROM public.pluggy_webhooks pw
     WHERE pw.pluggy_item_id = pi2.pluggy_item_id::TEXT
     ORDER BY pw.received_at DESC LIMIT 1
    )                                AS last_webhook_at,
    (SELECT pw.event_type
     FROM public.pluggy_webhooks pw
     WHERE pw.pluggy_item_id = pi2.pluggy_item_id::TEXT
     ORDER BY pw.received_at DESC LIMIT 1
    )                                AS last_webhook_event,
    -- totais
    (SELECT COUNT(*) FROM public.bank_transactions bt
     WHERE bt.store_id = p_store_id AND bt.bank_connection_id = bc.id)::BIGINT AS total_transactions,
    (SELECT COUNT(*) FROM public.reconciliation_matches rm
     JOIN public.bank_transactions bt ON bt.id = rm.bank_transaction_id
     WHERE rm.store_id = p_store_id AND bt.bank_connection_id = bc.id
       AND rm.status = 'pending')::BIGINT AS pending_matches,
    (SELECT COUNT(*) FROM public.bank_transactions bt
     WHERE bt.store_id = p_store_id AND bt.bank_connection_id = bc.id
       AND bt.status = 'divergent')::BIGINT AS divergent_count,
    pi2.error_code,
    pi2.error_message,
    -- flags de alertas
    (pi2.status IN ('login_error', 'outdated') OR bc.status = 'error') AS has_token_error,
    (bc.last_sync_status = 'failed' OR pi2.status = 'error')           AS has_sync_error,
    -- webhook considerado "estagnado" se > 48h sem receber
    (
      (SELECT pw.received_at
       FROM public.pluggy_webhooks pw
       WHERE pw.pluggy_item_id = pi2.pluggy_item_id::TEXT
       ORDER BY pw.received_at DESC LIMIT 1)
      < NOW() - INTERVAL '48 hours'
      OR NOT EXISTS (
        SELECT 1 FROM public.pluggy_webhooks pw
        WHERE pw.pluggy_item_id = pi2.pluggy_item_id::TEXT
      )
    )                                AS has_webhook_stale,
    EXTRACT(DAY FROM NOW() - pi2.last_synced_at)::INTEGER AS days_since_sync,
    EXTRACT(DAY FROM NOW() - (
      SELECT pw.received_at
      FROM public.pluggy_webhooks pw
      WHERE pw.pluggy_item_id = pi2.pluggy_item_id::TEXT
      ORDER BY pw.received_at DESC LIMIT 1
    ))::INTEGER                      AS days_since_webhook
  FROM public.bank_connections bc
  LEFT JOIN public.pluggy_items pi2
    ON pi2.id = bc.pluggy_item_id
  WHERE bc.store_id = p_store_id
    AND bc.is_active = true
  ORDER BY bc.bank_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_connection_health(UUID) TO authenticated;

-- ── 5. RPC: get_system_log_summary (contadores por tipo) ──────────────

CREATE OR REPLACE FUNCTION public.get_system_log_summary(
  p_store_id  UUID,
  p_days      INTEGER DEFAULT 7
)
RETURNS TABLE(
  log_type   TEXT,
  severity   TEXT,
  count      BIGINT,
  last_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    l.log_type,
    l.severity,
    COUNT(*)::BIGINT AS count,
    MAX(l.created_at) AS last_at
  FROM public.connect_system_logs l
  WHERE l.store_id = p_store_id
    AND l.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY l.log_type, l.severity
  ORDER BY l.log_type, l.severity;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_system_log_summary(UUID, INTEGER) TO authenticated;
