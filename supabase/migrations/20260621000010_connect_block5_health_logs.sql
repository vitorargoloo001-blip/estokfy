-- Block 5: Connection health monitoring — connect_system_logs table + log/query RPCs
-- Backfilled 2026-07-01: this migration was applied directly in production via the SQL
-- Editor on 2026-06-21 but never committed to git. Reconstructed from the live schema
-- (pg_get_functiondef / information_schema) to close the code/production gap found during
-- the Connect production audit. Idempotent (CREATE ... IF NOT EXISTS / OR REPLACE), safe
-- to run against a database that already has these objects.

CREATE TABLE IF NOT EXISTS public.connect_system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  log_type text NOT NULL CHECK (log_type = ANY (ARRAY['sync'::text, 'webhook'::text, 'error'::text, 'reconnect'::text, 'token_expired'::text, 'info'::text, 'match'::text])),
  message text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  bank_connection_id uuid REFERENCES public.bank_connections(id) ON DELETE SET NULL,
  pluggy_item_id uuid REFERENCES public.pluggy_items(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'info'::text CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connect_system_logs_store ON public.connect_system_logs USING btree (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_system_logs_type ON public.connect_system_logs USING btree (store_id, log_type, created_at DESC);

ALTER TABLE public.connect_system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connect_system_logs_store ON public.connect_system_logs;
CREATE POLICY connect_system_logs_store ON public.connect_system_logs FOR ALL
  USING (store_id IN (SELECT profiles.store_id FROM public.profiles WHERE profiles.auth_user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.add_connect_log(
  p_store_id uuid,
  p_log_type text,
  p_message text,
  p_details jsonb DEFAULT '{}'::jsonb,
  p_bank_connection_id uuid DEFAULT NULL::uuid,
  p_pluggy_item_id uuid DEFAULT NULL::uuid,
  p_severity text DEFAULT 'info'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_connect_logs(
  p_store_id uuid,
  p_log_type text DEFAULT NULL::text,
  p_severity text DEFAULT NULL::text,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, log_type text, message text, details jsonb, severity text, bank_connection_id uuid, bank_name text, pluggy_item_id uuid, institution_name text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_connection_health(p_store_id uuid)
RETURNS TABLE(bank_connection_id uuid, bank_name text, institution_name text, account_number text, account_type text, connection_status text, pluggy_status text, last_synced_at timestamp with time zone, last_webhook_at timestamp with time zone, last_webhook_event text, total_transactions bigint, pending_matches bigint, divergent_count bigint, error_code text, error_message text, has_token_error boolean, has_sync_error boolean, has_webhook_stale boolean, days_since_sync integer, days_since_webhook integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    bc.id                             AS bank_connection_id,
    bc.bank_name,
    pi2.institution_name,
    bc.account_number,
    bc.account_type,
    bc.status                        AS connection_status,
    pi2.status                       AS pluggy_status,
    pi2.last_synced_at,
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
    (pi2.status IN ('login_error', 'outdated') OR bc.status = 'error') AS has_token_error,
    (bc.last_sync_status = 'failed' OR pi2.status = 'error')           AS has_sync_error,
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
$function$;
