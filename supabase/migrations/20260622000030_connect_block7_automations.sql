-- =====================================================================
-- Connect Block 7 — Automações Inteligentes
-- Tables: connect_automations, connect_automation_runs,
--         connect_automation_logs, connect_notifications,
--         connect_notification_recipients
-- =====================================================================

-- ── Tabela principal de automações ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_automations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN (
    'auto_reconciliation','divergence_alert','bank_disconnected',
    'daily_report','weekly_report','overdue_collection','cashflow_risk'
  )),
  name             TEXT NOT NULL,
  description      TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  config           JSONB NOT NULL DEFAULT '{}',
  schedule_config  JSONB NOT NULL DEFAULT '{"frequency":"daily","hour":8,"minute":0}',
  channels         TEXT[] NOT NULL DEFAULT ARRAY['internal'],
  last_run_at      TIMESTAMPTZ,
  next_run_at      TIMESTAMPTZ,
  last_run_status  TEXT CHECK (last_run_status IN ('success','error','pending','skipped','pending_approval')),
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Execuções de automação ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_automation_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id    UUID NOT NULL REFERENCES public.connect_automations(id) ON DELETE CASCADE,
  store_id         UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (status IN (
    'running','success','error','skipped','pending_approval'
  )),
  trigger_type     TEXT NOT NULL CHECK (trigger_type IN ('manual','cron','ai','test')),
  triggered_by     UUID REFERENCES auth.users(id),
  idempotency_key  TEXT UNIQUE,
  result           JSONB,
  error_message    TEXT,
  duration_ms      INTEGER,
  items_affected   INTEGER DEFAULT 0,
  requires_approval BOOLEAN DEFAULT false,
  approved_by      UUID REFERENCES auth.users(id),
  approved_at      TIMESTAMPTZ,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

-- ── Logs detalhados por execução ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_automation_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     UUID NOT NULL REFERENCES public.connect_automation_runs(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  log_level  TEXT NOT NULL CHECK (log_level IN ('info','warning','error')),
  message    TEXT NOT NULL,
  details    JSONB,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Notificações geradas pelas automações ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  automation_id UUID REFERENCES public.connect_automations(id) ON DELETE SET NULL,
  run_id        UUID REFERENCES public.connect_automation_runs(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  channel       TEXT NOT NULL CHECK (channel IN ('internal','email','whatsapp','sms','webhook')),
  status        TEXT NOT NULL CHECK (status IN ('pending','sent','failed','read','dismissed')),
  sent_at       TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Destinatários de notificações ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_notification_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES public.connect_automations(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id),
  email         TEXT,
  channel       TEXT NOT NULL CHECK (channel IN ('internal','email','whatsapp','sms','webhook')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Índices ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS connect_automations_store_idx ON public.connect_automations(store_id);
CREATE INDEX IF NOT EXISTS connect_automations_active_idx ON public.connect_automations(store_id, is_active);
CREATE INDEX IF NOT EXISTS connect_automation_runs_auto_idx ON public.connect_automation_runs(automation_id);
CREATE INDEX IF NOT EXISTS connect_automation_runs_store_idx ON public.connect_automation_runs(store_id, started_at DESC);
CREATE INDEX IF NOT EXISTS connect_automation_runs_approval_idx ON public.connect_automation_runs(store_id, requires_approval, status) WHERE requires_approval = true;
CREATE INDEX IF NOT EXISTS connect_automation_logs_run_idx ON public.connect_automation_logs(run_id);
CREATE INDEX IF NOT EXISTS connect_notifications_store_idx ON public.connect_notifications(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS connect_notifications_unread_idx ON public.connect_notifications(store_id, status) WHERE status IN ('pending','sent');

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.connect_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_notification_recipients ENABLE ROW LEVEL SECURITY;

-- Automações: leitura para todos da loja, escrita apenas para owner/admin/manager/finance
CREATE POLICY "connect_automations_read" ON public.connect_automations
  FOR SELECT USING (store_id = public.get_my_store_id());
CREATE POLICY "connect_automations_write" ON public.connect_automations
  FOR ALL USING (
    store_id = public.get_my_store_id()
    AND public.get_my_role() = ANY(ARRAY['owner','admin','manager','finance'])
  );

-- Runs e logs: todos da loja podem ver
CREATE POLICY "connect_runs_read" ON public.connect_automation_runs
  FOR SELECT USING (store_id = public.get_my_store_id());
CREATE POLICY "connect_logs_read" ON public.connect_automation_logs
  FOR SELECT USING (store_id = public.get_my_store_id());
CREATE POLICY "connect_notifications_read" ON public.connect_notifications
  FOR SELECT USING (store_id = public.get_my_store_id());
CREATE POLICY "connect_notifications_update" ON public.connect_notifications
  FOR UPDATE USING (store_id = public.get_my_store_id());
CREATE POLICY "connect_recipients_read" ON public.connect_notification_recipients
  FOR SELECT USING (store_id = public.get_my_store_id());
CREATE POLICY "connect_recipients_write" ON public.connect_notification_recipients
  FOR ALL USING (
    store_id = public.get_my_store_id()
    AND public.get_my_role() = ANY(ARRAY['owner','admin','manager','finance'])
  );

-- ── Helper: verificar permissão de automação ──────────────────────────
CREATE OR REPLACE FUNCTION public._has_automation_permission(p_store_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND store_id = p_store_id
      AND role = ANY(ARRAY['owner','admin','manager','finance'])
  );
$$;

-- ── RPC: listar automações com stats ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_connect_automations(p_store_id UUID)
RETURNS TABLE (
  id UUID, type TEXT, name TEXT, description TEXT,
  is_active BOOLEAN, config JSONB, schedule_config JSONB, channels TEXT[],
  last_run_at TIMESTAMPTZ, next_run_at TIMESTAMPTZ, last_run_status TEXT,
  created_by UUID, updated_at TIMESTAMPTZ,
  runs_today INT, runs_total INT, errors_total INT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.id, a.type, a.name, a.description,
    a.is_active, a.config, a.schedule_config, a.channels,
    a.last_run_at, a.next_run_at, a.last_run_status,
    a.created_by, a.updated_at,
    COUNT(r.id) FILTER (WHERE r.started_at >= CURRENT_DATE)::INT AS runs_today,
    COUNT(r.id)::INT AS runs_total,
    COUNT(r.id) FILTER (WHERE r.status = 'error')::INT AS errors_total
  FROM connect_automations a
  LEFT JOIN connect_automation_runs r ON r.automation_id = a.id
  WHERE a.store_id = p_store_id
    AND a.store_id = get_my_store_id()
  GROUP BY a.id
  ORDER BY a.created_at;
$$;
REVOKE ALL ON FUNCTION public.get_connect_automations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_connect_automations(UUID) TO authenticated;

-- ── RPC: criar automação ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_connect_automation(
  p_store_id      UUID,
  p_type          TEXT,
  p_name          TEXT,
  p_description   TEXT DEFAULT NULL,
  p_config        JSONB DEFAULT '{}',
  p_schedule      JSONB DEFAULT '{"frequency":"daily","hour":8,"minute":0}',
  p_channels      TEXT[] DEFAULT ARRAY['internal'],
  p_is_active     BOOLEAN DEFAULT true
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT _has_automation_permission(p_store_id) THEN
    RAISE EXCEPTION 'Permissão insuficiente. Requer role owner, admin, manager ou finance.';
  END IF;

  INSERT INTO connect_automations (
    store_id, type, name, description, config, schedule_config,
    channels, is_active, created_by, updated_by
  ) VALUES (
    p_store_id, p_type, p_name, p_description, p_config, p_schedule,
    p_channels, p_is_active, auth.uid(), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_connect_automation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_connect_automation TO authenticated;

-- ── RPC: atualizar automação ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_connect_automation(
  p_id          UUID,
  p_store_id    UUID,
  p_name        TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_config      JSONB DEFAULT NULL,
  p_schedule    JSONB DEFAULT NULL,
  p_channels    TEXT[] DEFAULT NULL,
  p_is_active   BOOLEAN DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_automation_permission(p_store_id) THEN
    RAISE EXCEPTION 'Permissão insuficiente.';
  END IF;

  UPDATE connect_automations SET
    name            = COALESCE(p_name, name),
    description     = COALESCE(p_description, description),
    config          = COALESCE(p_config, config),
    schedule_config = COALESCE(p_schedule, schedule_config),
    channels        = COALESCE(p_channels, channels),
    is_active       = COALESCE(p_is_active, is_active),
    updated_by      = auth.uid(),
    updated_at      = now()
  WHERE id = p_id AND store_id = p_store_id;

  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.update_connect_automation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_connect_automation TO authenticated;

-- ── RPC: toggle ativo/inativo ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.toggle_connect_automation(p_id UUID, p_store_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_active BOOLEAN;
BEGIN
  IF NOT _has_automation_permission(p_store_id) THEN
    RAISE EXCEPTION 'Permissão insuficiente.';
  END IF;

  UPDATE connect_automations
  SET is_active = NOT is_active, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_id AND store_id = p_store_id
  RETURNING is_active INTO v_active;

  RETURN jsonb_build_object('is_active', v_active);
END;
$$;
REVOKE ALL ON FUNCTION public.toggle_connect_automation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_connect_automation TO authenticated;

-- ── RPC: deletar automação ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_connect_automation(p_id UUID, p_store_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_automation_permission(p_store_id) THEN
    RAISE EXCEPTION 'Permissão insuficiente.';
  END IF;

  DELETE FROM connect_automations WHERE id = p_id AND store_id = p_store_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_connect_automation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_connect_automation TO authenticated;

-- ── RPC: iniciar execução (com idempotência) ───────────────────────────
CREATE OR REPLACE FUNCTION public.start_automation_run(
  p_automation_id  UUID,
  p_store_id       UUID,
  p_trigger_type   TEXT DEFAULT 'manual',
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run_id  UUID;
  v_exists  BOOLEAN;
  v_type    TEXT;
BEGIN
  -- Verificar que a automação pertence à loja
  SELECT type INTO v_type
  FROM connect_automations
  WHERE id = p_automation_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automação não encontrada.';
  END IF;

  -- Idempotência: verificar execução recente com a mesma chave
  IF p_idempotency_key IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM connect_automation_runs
      WHERE idempotency_key = p_idempotency_key
    ) INTO v_exists;

    IF v_exists THEN
      RETURN NULL; -- Já executado, pular
    END IF;
  END IF;

  -- Determinar se requer aprovação
  DECLARE v_needs_approval BOOLEAN := (v_type = 'overdue_collection');
  BEGIN
    INSERT INTO connect_automation_runs (
      automation_id, store_id, status, trigger_type,
      triggered_by, idempotency_key, requires_approval
    ) VALUES (
      p_automation_id, p_store_id, 'running', p_trigger_type,
      auth.uid(), p_idempotency_key,
      v_needs_approval
    ) RETURNING id INTO v_run_id;
  END;

  -- Atualizar last_run_at na automação
  UPDATE connect_automations
  SET last_run_at = now(), last_run_status = 'pending', updated_at = now()
  WHERE id = p_automation_id;

  RETURN v_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_automation_run FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_automation_run TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_automation_run TO service_role;

-- ── RPC: completar execução ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_automation_run(
  p_run_id       UUID,
  p_status       TEXT,
  p_result       JSONB DEFAULT NULL,
  p_error        TEXT DEFAULT NULL,
  p_items        INT DEFAULT 0,
  p_duration_ms  INT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auto_id UUID;
  v_store_id UUID;
BEGIN
  UPDATE connect_automation_runs SET
    status        = p_status,
    result        = p_result,
    error_message = p_error,
    items_affected = p_items,
    duration_ms   = p_duration_ms,
    completed_at  = now()
  WHERE id = p_run_id
  RETURNING automation_id, store_id INTO v_auto_id, v_store_id;

  IF NOT FOUND THEN RETURN false; END IF;

  -- Atualizar status na automação pai
  UPDATE connect_automations
  SET last_run_status = p_status, updated_at = now()
  WHERE id = v_auto_id;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_automation_run FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_automation_run TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_automation_run TO service_role;

-- ── RPC: aprovar execução pendente ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_automation_run(p_run_id UUID, p_store_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_automation_permission(p_store_id) THEN
    RAISE EXCEPTION 'Permissão insuficiente.';
  END IF;

  UPDATE connect_automation_runs SET
    status      = 'success',
    approved_by = auth.uid(),
    approved_at = now(),
    completed_at = now()
  WHERE id = p_run_id
    AND store_id = p_store_id
    AND requires_approval = true
    AND status = 'pending_approval';

  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_automation_run FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_automation_run TO authenticated;

-- ── RPC: registrar log de execução ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_automation_log(
  p_run_id   UUID,
  p_store_id UUID,
  p_level    TEXT,
  p_message  TEXT,
  p_details  JSONB DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO connect_automation_logs (run_id, store_id, log_level, message, details)
  VALUES (p_run_id, p_store_id, p_level, p_message, p_details);
END;
$$;
REVOKE ALL ON FUNCTION public.add_automation_log FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_automation_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_automation_log TO service_role;

-- ── RPC: criar notificação interna ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_connect_notification(
  p_store_id     UUID,
  p_type         TEXT,
  p_title        TEXT,
  p_body         TEXT,
  p_severity     TEXT DEFAULT 'info',
  p_channel      TEXT DEFAULT 'internal',
  p_automation_id UUID DEFAULT NULL,
  p_run_id       UUID DEFAULT NULL,
  p_metadata     JSONB DEFAULT '{}'
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO connect_notifications (
    store_id, automation_id, run_id, type, title, body,
    severity, channel, status, metadata
  ) VALUES (
    p_store_id, p_automation_id, p_run_id, p_type, p_title, p_body,
    p_severity, p_channel, 'sent', p_metadata
  ) RETURNING id INTO v_id;

  UPDATE connect_notifications SET sent_at = now() WHERE id = v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_connect_notification FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_connect_notification TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_connect_notification TO service_role;

-- ── RPC: buscar notificações ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_connect_notifications(
  p_store_id    UUID,
  p_unread_only BOOLEAN DEFAULT false,
  p_limit       INT DEFAULT 30
) RETURNS SETOF public.connect_notifications
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM connect_notifications
  WHERE store_id = p_store_id
    AND store_id = get_my_store_id()
    AND (NOT p_unread_only OR status IN ('pending','sent'))
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.get_connect_notifications FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_connect_notifications TO authenticated;

-- ── RPC: marcar notificação como lida ────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id UUID, p_store_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE connect_notifications
  SET status = 'read', read_at = now()
  WHERE id = p_id AND store_id = p_store_id AND store_id = get_my_store_id();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_notification_read FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_read TO authenticated;

-- ── RPC: buscar execuções de uma automação ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_automation_runs(
  p_automation_id UUID,
  p_store_id      UUID,
  p_limit         INT DEFAULT 20
) RETURNS TABLE (
  id UUID, status TEXT, trigger_type TEXT, triggered_by UUID,
  result JSONB, error_message TEXT, duration_ms INT,
  items_affected INT, requires_approval BOOLEAN,
  approved_by UUID, approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.status, r.trigger_type, r.triggered_by,
    r.result, r.error_message, r.duration_ms,
    r.items_affected, r.requires_approval,
    r.approved_by, r.approved_at,
    r.started_at, r.completed_at
  FROM connect_automation_runs r
  WHERE r.automation_id = p_automation_id
    AND r.store_id = p_store_id
    AND r.store_id = get_my_store_id()
  ORDER BY r.started_at DESC
  LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.get_automation_runs FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_automation_runs TO authenticated;

-- ── RPC: dashboard de automações ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_automations_dashboard(p_store_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_active    INT;
  v_runs_today      INT;
  v_errors_today    INT;
  v_pending_approval INT;
  v_notifications   INT;
  v_next_run        TIMESTAMPTZ;
BEGIN
  SELECT COUNT(*) INTO v_total_active
  FROM connect_automations WHERE store_id = p_store_id AND is_active = true;

  SELECT COUNT(*) INTO v_runs_today
  FROM connect_automation_runs r
  JOIN connect_automations a ON a.id = r.automation_id
  WHERE a.store_id = p_store_id AND r.started_at >= CURRENT_DATE;

  SELECT COUNT(*) INTO v_errors_today
  FROM connect_automation_runs r
  JOIN connect_automations a ON a.id = r.automation_id
  WHERE a.store_id = p_store_id AND r.started_at >= CURRENT_DATE AND r.status = 'error';

  SELECT COUNT(*) INTO v_pending_approval
  FROM connect_automation_runs r
  JOIN connect_automations a ON a.id = r.automation_id
  WHERE a.store_id = p_store_id AND r.status = 'pending_approval';

  SELECT COUNT(*) INTO v_notifications
  FROM connect_notifications
  WHERE store_id = p_store_id AND status IN ('pending','sent');

  SELECT MIN(next_run_at) INTO v_next_run
  FROM connect_automations
  WHERE store_id = p_store_id AND is_active = true AND next_run_at > now();

  RETURN jsonb_build_object(
    'total_active',      v_total_active,
    'runs_today',        v_runs_today,
    'errors_today',      v_errors_today,
    'pending_approval',  v_pending_approval,
    'unread_notifications', v_notifications,
    'next_run_at',       v_next_run
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_automations_dashboard FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_automations_dashboard TO authenticated;

-- ── RPC: aprovações pendentes ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pending_approvals(p_store_id UUID)
RETURNS TABLE (
  run_id UUID, automation_id UUID, automation_name TEXT, automation_type TEXT,
  result JSONB, started_at TIMESTAMPTZ, triggered_by UUID
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, a.id, a.name, a.type,
    r.result, r.started_at, r.triggered_by
  FROM connect_automation_runs r
  JOIN connect_automations a ON a.id = r.automation_id
  WHERE a.store_id = p_store_id
    AND a.store_id = get_my_store_id()
    AND r.status = 'pending_approval'
    AND r.requires_approval = true
  ORDER BY r.started_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_pending_approvals FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_approvals TO authenticated;

-- ── RPC: trigger automações baseadas em insights da IA ────────────────
CREATE OR REPLACE FUNCTION public.trigger_ai_automations(p_store_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auto     RECORD;
  v_insight  RECORD;
  v_triggered INT := 0;
  v_notifs   INT := 0;
  v_health   JSONB;
  v_diverg   INT;
  v_offline  INT;
BEGIN
  IF get_my_store_id() <> p_store_id THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Para cada automação ativa de tipo monitoramento
  FOR v_auto IN
    SELECT * FROM connect_automations
    WHERE store_id = p_store_id AND is_active = true
      AND type IN ('divergence_alert','bank_disconnected','cashflow_risk')
  LOOP
    v_triggered := v_triggered + 1;

    IF v_auto.type = 'divergence_alert' THEN
      -- Contar divergências abertas
      SELECT COUNT(*) INTO v_diverg
      FROM bank_transactions
      WHERE store_id = p_store_id AND status = 'divergent';

      DECLARE v_min_diverg INT := COALESCE((v_auto.config->>'min_divergences')::INT, 1);
      BEGIN
        IF v_diverg >= v_min_diverg THEN
          PERFORM create_connect_notification(
            p_store_id,
            'divergence_alert',
            format('⚠️ %s divergência(s) detectada(s)', v_diverg),
            format('Existem %s transações bancárias divergentes aguardando revisão.', v_diverg),
            CASE WHEN v_diverg > 10 THEN 'critical' WHEN v_diverg > 3 THEN 'warning' ELSE 'info' END,
            'internal',
            v_auto.id, NULL,
            jsonb_build_object('divergent_count', v_diverg)
          );
          v_notifs := v_notifs + 1;
        END IF;
      END;
    END IF;

    IF v_auto.type = 'bank_disconnected' THEN
      DECLARE v_max_hours INT := COALESCE((v_auto.config->>'max_hours_offline')::INT, 24);
      BEGIN
        SELECT COUNT(*) INTO v_offline
        FROM bank_connections
        WHERE store_id = p_store_id
          AND status IN ('error','disconnected')
          AND (last_sync_at IS NULL OR last_sync_at < now() - (v_max_hours || ' hours')::INTERVAL);

        IF v_offline > 0 THEN
          PERFORM create_connect_notification(
            p_store_id,
            'bank_disconnected',
            format('🏦 %s banco(s) desconectado(s)', v_offline),
            format('%s conexão(ões) bancária(s) sem sincronização há mais de %s horas.', v_offline, v_max_hours),
            'critical',
            'internal',
            v_auto.id, NULL,
            jsonb_build_object('offline_count', v_offline)
          );
          v_notifs := v_notifs + 1;
        END IF;
      END;
    END IF;

    IF v_auto.type = 'cashflow_risk' THEN
      DECLARE
        v_threshold NUMERIC := COALESCE((v_auto.config->>'at_risk_threshold_pct')::NUMERIC, 30);
        v_at_risk   NUMERIC;
        v_total_fc  NUMERIC;
      BEGIN
        SELECT COALESCE(SUM(amount), 0) INTO v_at_risk
        FROM bank_transactions
        WHERE store_id = p_store_id
          AND transaction_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
          AND type = 'debit';

        SELECT COALESCE(SUM(net_total), 0) INTO v_total_fc
        FROM sales
        WHERE store_id = p_store_id
          AND payment_status IN ('pending','partial')
          AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
          AND deleted_at IS NULL;

        IF v_total_fc > 0 AND (v_at_risk / v_total_fc * 100) >= v_threshold THEN
          PERFORM create_connect_notification(
            p_store_id,
            'cashflow_risk',
            '📈 Risco no fluxo de caixa detectado',
            format('%.0f%% do fluxo previsto (R$ %.2f) está em risco nos próximos 30 dias.',
              v_at_risk / v_total_fc * 100, v_at_risk),
            'warning',
            'internal',
            v_auto.id, NULL,
            jsonb_build_object('at_risk', v_at_risk, 'total_forecast', v_total_fc)
          );
          v_notifs := v_notifs + 1;
        END IF;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('triggered', v_triggered, 'notifications_created', v_notifs);
END;
$$;
REVOKE ALL ON FUNCTION public.trigger_ai_automations FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_ai_automations TO authenticated;
