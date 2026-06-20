-- =====================================================================
-- Connect: Sistema de Alertas
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.connect_alerts (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id     UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  alert_type   TEXT NOT NULL CHECK (alert_type IN (
    'divergent_transaction', 'low_reconciliation_rate', 'bank_connection_error',
    'sync_failed', 'pending_too_long', 'demo'
  )),
  severity     TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('error', 'warning', 'info')),
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    UUID,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.connect_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connect_alerts_store_isolation"
ON public.connect_alerts
FOR ALL
USING (
  store_id = (
    SELECT p.store_id FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
    LIMIT 1
  )
);

CREATE INDEX IF NOT EXISTS idx_connect_alerts_store ON public.connect_alerts(store_id);
CREATE INDEX IF NOT EXISTS idx_connect_alerts_created ON public.connect_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_alerts_unread ON public.connect_alerts(store_id, is_read) WHERE dismissed_at IS NULL;

-- =====================================================================
-- RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_connect_alert(
  p_store_id    UUID,
  p_alert_type  TEXT,
  p_severity    TEXT,
  p_title       TEXT,
  p_message     TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id   UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.connect_alerts (
    store_id, alert_type, severity, title, message, entity_type, entity_id
  ) VALUES (
    p_store_id, p_alert_type, p_severity, p_title, p_message, p_entity_type, p_entity_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_connect_alert(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- -----

CREATE OR REPLACE FUNCTION public.list_connect_alerts(
  p_store_id          UUID,
  p_include_dismissed BOOLEAN DEFAULT false
)
RETURNS TABLE (
  id           UUID,
  alert_type   TEXT,
  severity     TEXT,
  title        TEXT,
  message      TEXT,
  entity_type  TEXT,
  entity_id    UUID,
  is_read      BOOLEAN,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id, a.alert_type, a.severity, a.title, a.message,
    a.entity_type, a.entity_id, a.is_read, a.dismissed_at, a.created_at
  FROM public.connect_alerts a
  WHERE a.store_id = p_store_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = p_store_id
        AND p.role IN ('owner','admin','manager','finance','viewer')
    )
    AND (p_include_dismissed OR a.dismissed_at IS NULL)
  ORDER BY
    CASE a.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
    a.created_at DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.list_connect_alerts(UUID, BOOLEAN) TO authenticated;

-- -----

CREATE OR REPLACE FUNCTION public.dismiss_connect_alert(p_alert_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id UUID;
BEGIN
  SELECT store_id INTO v_store_id FROM public.connect_alerts WHERE id = p_alert_id;
  IF v_store_id IS NULL THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN RETURN false; END IF;

  UPDATE public.connect_alerts SET dismissed_at = now() WHERE id = p_alert_id AND dismissed_at IS NULL;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_connect_alert(UUID) TO authenticated;

-- -----

CREATE OR REPLACE FUNCTION public.mark_connect_alert_read(p_alert_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id UUID;
BEGIN
  SELECT store_id INTO v_store_id FROM public.connect_alerts WHERE id = p_alert_id;
  IF v_store_id IS NULL THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance','viewer')
  ) THEN RETURN false; END IF;

  UPDATE public.connect_alerts SET is_read = true WHERE id = p_alert_id;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_connect_alert_read(UUID) TO authenticated;

-- -----

CREATE OR REPLACE FUNCTION public.dismiss_all_connect_alerts(p_store_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN RETURN 0; END IF;

  UPDATE public.connect_alerts
  SET dismissed_at = now()
  WHERE store_id = p_store_id AND dismissed_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_all_connect_alerts(UUID) TO authenticated;

-- -----

CREATE OR REPLACE FUNCTION public.get_unread_alert_count(p_store_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.connect_alerts
  WHERE store_id = p_store_id
    AND is_read = false
    AND dismissed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = p_store_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_alert_count(UUID) TO authenticated;

-- =====================================================================
-- Trigger: gera alerta ao inserir transação divergente
-- =====================================================================

CREATE OR REPLACE FUNCTION public.trigger_divergent_transaction_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'divergent' AND (TG_OP = 'INSERT' OR OLD.status != 'divergent') THEN
    INSERT INTO public.connect_alerts (
      store_id, alert_type, severity, title, message, entity_type, entity_id
    ) VALUES (
      NEW.store_id,
      'divergent_transaction',
      'warning',
      'Transação divergente detectada',
      'Transação bancária de R$' || to_char(NEW.amount, 'FM999G999D99') ||
        ' em ' || to_char(NEW.transaction_date, 'DD/MM/YYYY') ||
        ' não encontrou correspondência nas vendas.',
      'bank_transaction',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_divergent_transaction_alert ON public.bank_transactions;
CREATE TRIGGER trg_divergent_transaction_alert
AFTER INSERT OR UPDATE OF status ON public.bank_transactions
FOR EACH ROW EXECUTE FUNCTION public.trigger_divergent_transaction_alert();
