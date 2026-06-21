-- =====================================================================
-- Connect Block 3 — RPCs avançados + email_alert_settings
-- =====================================================================

-- ── 1. get_reconciliation_by_method ──────────────────────────────────
-- Breakdown de transações por método de pagamento
CREATE OR REPLACE FUNCTION public.get_reconciliation_by_method(
  p_store_id   UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date   DATE DEFAULT NULL
)
RETURNS TABLE (
  method            TEXT,
  total_count       INTEGER,
  total_amount      NUMERIC,
  reconciled_count  INTEGER,
  reconciled_amount NUMERIC,
  divergent_count   INTEGER,
  pending_count     INTEGER,
  reconciliation_rate NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bt.method                                          AS method,
    COUNT(*)::int                                              AS total_count,
    COALESCE(SUM(bt.amount), 0)                               AS total_amount,
    COUNT(*) FILTER (WHERE bt.status IN ('reconciled','confirmed'))::int AS reconciled_count,
    COALESCE(SUM(bt.amount) FILTER (WHERE bt.status IN ('reconciled','confirmed')), 0) AS reconciled_amount,
    COUNT(*) FILTER (WHERE bt.status = 'divergent')::int      AS divergent_count,
    COUNT(*) FILTER (WHERE bt.status = 'pending')::int        AS pending_count,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE ROUND(
           COUNT(*) FILTER (WHERE bt.status IN ('reconciled','confirmed'))::numeric
           / COUNT(*)::numeric * 100, 1
         )
    END                                                        AS reconciliation_rate
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND (p_start_date IS NULL OR bt.transaction_date >= p_start_date)
    AND (p_end_date   IS NULL OR bt.transaction_date <= p_end_date)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
    )
  GROUP BY bt.method
  ORDER BY total_amount DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_reconciliation_by_method(UUID, DATE, DATE) TO authenticated;

-- ── 2. get_monthly_comparison ─────────────────────────────────────────
-- Compara mês atual vs mês anterior
CREATE OR REPLACE FUNCTION public.get_monthly_comparison(p_store_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r) FROM (
    SELECT
      -- Mês atual
      COALESCE(SUM(bt.amount) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', CURRENT_DATE)
          AND bt.status IN ('reconciled','confirmed')
      ), 0) AS current_month_reconciled,

      COALESCE(SUM(bt.amount) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', CURRENT_DATE)
      ), 0) AS current_month_total,

      COUNT(*) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', CURRENT_DATE)
          AND bt.status = 'divergent'
      )::int AS current_month_divergent,

      -- Mês anterior
      COALESCE(SUM(bt.amount) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
          AND bt.transaction_date <  date_trunc('month', CURRENT_DATE)
          AND bt.status IN ('reconciled','confirmed')
      ), 0) AS prev_month_reconciled,

      COALESCE(SUM(bt.amount) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
          AND bt.transaction_date <  date_trunc('month', CURRENT_DATE)
      ), 0) AS prev_month_total,

      COUNT(*) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
          AND bt.transaction_date <  date_trunc('month', CURRENT_DATE)
          AND bt.status = 'divergent'
      )::int AS prev_month_divergent

    FROM public.bank_transactions bt
    WHERE bt.store_id = p_store_id
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
      )
  ) r;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_comparison(UUID) TO authenticated;

-- ── 3. get_divergence_history ─────────────────────────────────────────
-- Histórico de divergências resolvidas e ignoradas
CREATE OR REPLACE FUNCTION public.get_divergence_history(
  p_store_id   UUID,
  p_status     TEXT DEFAULT NULL,   -- 'reconciled' | 'ignored' | NULL = ambos
  p_start_date DATE DEFAULT NULL,
  p_end_date   DATE DEFAULT NULL,
  p_limit      INTEGER DEFAULT 100,
  p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE (
  id               UUID,
  transaction_date DATE,
  amount           NUMERIC,
  description      TEXT,
  method           TEXT,
  bank_name        TEXT,
  divergence_type  TEXT,
  divergence_reason TEXT,
  status           TEXT,
  resolved_at      TIMESTAMPTZ,
  resolved_by      TEXT,
  linked_sale_id   UUID,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bt.id,
    bt.transaction_date,
    bt.amount,
    bt.description,
    bt.method,
    bt.bank_name,
    bt.divergence_type,
    bt.divergence_reason,
    bt.status,
    rm.confirmed_at          AS resolved_at,
    u.email                  AS resolved_by,
    rm.sale_id               AS linked_sale_id,
    bt.created_at
  FROM public.bank_transactions bt
  LEFT JOIN public.reconciliation_matches rm
    ON rm.bank_transaction_id = bt.id AND rm.status = 'confirmed'
  LEFT JOIN public.profiles pr ON pr.id = rm.confirmed_by
  LEFT JOIN auth.users u ON u.id = pr.auth_user_id
  WHERE bt.store_id = p_store_id
    AND bt.divergence_type IS NOT NULL          -- só os que tiveram divergência
    AND bt.status IN ('reconciled','confirmed','ignored')
    AND (p_status IS NULL OR bt.status = p_status)
    AND (p_start_date IS NULL OR bt.transaction_date >= p_start_date)
    AND (p_end_date   IS NULL OR bt.transaction_date <= p_end_date)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
    )
  ORDER BY COALESCE(rm.confirmed_at, bt.created_at) DESC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.get_divergence_history(UUID, TEXT, DATE, DATE, INTEGER, INTEGER) TO authenticated;

-- ── 4. email_alert_settings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_alert_settings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  is_enabled       BOOLEAN NOT NULL DEFAULT false,
  email_to         TEXT,
  on_divergent     BOOLEAN NOT NULL DEFAULT true,
  on_low_rate      BOOLEAN NOT NULL DEFAULT true,
  on_duplicate     BOOLEAN NOT NULL DEFAULT true,
  on_pending       BOOLEAN NOT NULL DEFAULT false,
  low_rate_threshold NUMERIC NOT NULL DEFAULT 70,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id)
);

ALTER TABLE public.email_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_alert_settings_select ON public.email_alert_settings
  FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());

CREATE POLICY email_alert_settings_upsert ON public.email_alert_settings
  FOR ALL TO authenticated
  USING (store_id = public.get_my_store_id())
  WITH CHECK (store_id = public.get_my_store_id());

CREATE INDEX IF NOT EXISTS idx_email_alert_settings_store
  ON public.email_alert_settings(store_id);

-- ── 5. upsert_email_alert_settings ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_email_alert_settings(
  p_store_id          UUID,
  p_is_enabled        BOOLEAN,
  p_email_to          TEXT,
  p_on_divergent      BOOLEAN DEFAULT true,
  p_on_low_rate       BOOLEAN DEFAULT true,
  p_on_duplicate      BOOLEAN DEFAULT true,
  p_on_pending        BOOLEAN DEFAULT false,
  p_low_rate_threshold NUMERIC DEFAULT 70
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles
  WHERE auth_user_id = auth.uid() AND store_id = p_store_id;

  IF v_role IS NULL THEN
    RETURN QUERY SELECT false, 'Acesso negado';
    RETURN;
  END IF;

  IF v_role NOT IN ('owner','admin') THEN
    RETURN QUERY SELECT false, 'Somente owner ou admin podem configurar alertas por email';
    RETURN;
  END IF;

  INSERT INTO public.email_alert_settings (
    store_id, is_enabled, email_to, on_divergent, on_low_rate,
    on_duplicate, on_pending, low_rate_threshold, updated_at
  ) VALUES (
    p_store_id, p_is_enabled, p_email_to, p_on_divergent, p_on_low_rate,
    p_on_duplicate, p_on_pending, p_low_rate_threshold, now()
  )
  ON CONFLICT (store_id) DO UPDATE SET
    is_enabled           = EXCLUDED.is_enabled,
    email_to             = EXCLUDED.email_to,
    on_divergent         = EXCLUDED.on_divergent,
    on_low_rate          = EXCLUDED.on_low_rate,
    on_duplicate         = EXCLUDED.on_duplicate,
    on_pending           = EXCLUDED.on_pending,
    low_rate_threshold   = EXCLUDED.low_rate_threshold,
    updated_at           = now();

  RETURN QUERY SELECT true, 'Configurações salvas com sucesso';
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_email_alert_settings(UUID,BOOLEAN,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,NUMERIC) TO authenticated;

-- ── 6. get_email_alert_settings ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_email_alert_settings(p_store_id UUID)
RETURNS TABLE(
  is_enabled BOOLEAN, email_to TEXT,
  on_divergent BOOLEAN, on_low_rate BOOLEAN, on_duplicate BOOLEAN, on_pending BOOLEAN,
  low_rate_threshold NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_enabled, email_to, on_divergent, on_low_rate, on_duplicate, on_pending, low_rate_threshold
  FROM public.email_alert_settings
  WHERE store_id = p_store_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_email_alert_settings(UUID) TO authenticated;
