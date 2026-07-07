-- =====================================================================
-- Feature: fazer a conciliação bancária rodar sozinha, sem depender de
-- alguém clicar em "rodar agora". O caminho principal (import_bank_statement)
-- já dispara connect_run_matching na hora do upload — este tick diário é a
-- rede de segurança para casos em que ficaram pagamentos sem match (ex:
-- pagamento registrado depois do último import, ou um match ignorado que
-- pode ser retentado contra outra transação) e para lembrar a loja de
-- importar um extrato novo quando a conexão está desatualizada.
--
-- Sem provedor externo: usa pg_cron (extensão do próprio Postgres do
-- Supabase), não uma integração bancária de terceiros.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Tick diário: reprocessa matching + alerta de extrato desatualizado ──
CREATE OR REPLACE FUNCTION public.connect_cron_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store       RECORD;
  v_conn        RECORD;
  v_stale_days  CONSTANT INTEGER := 3;
  v_stores_processed INTEGER := 0;
  v_alerts_created    INTEGER := 0;
BEGIN
  FOR v_store IN
    SELECT DISTINCT bc.store_id
    FROM public.bank_connections bc
    JOIN public.connect_licenses cl ON cl.store_id = bc.store_id AND cl.status = 'active'
    WHERE bc.is_active = true
      AND bc.status = 'connected'
  LOOP
    PERFORM public._connect_run_matching_core(v_store.store_id);
    v_stores_processed := v_stores_processed + 1;

    FOR v_conn IN
      SELECT id, bank_name, last_sync_at
      FROM public.bank_connections
      WHERE store_id = v_store.store_id
        AND is_active = true
        AND status = 'connected'
        AND (last_sync_at IS NULL OR last_sync_at < now() - (v_stale_days || ' days')::interval)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.connect_alerts
        WHERE store_id = v_store.store_id
          AND alert_type = 'pending_too_long'
          AND entity_type = 'bank_connection'
          AND entity_id = v_conn.id
          AND dismissed_at IS NULL
          AND created_at > now() - (v_stale_days || ' days')::interval
      ) THEN
        PERFORM public.create_connect_alert(
          v_store.store_id,
          'pending_too_long',
          'warning',
          'Extrato bancário desatualizado',
          'Faz mais de ' || v_stale_days || ' dias que nenhum extrato foi importado para ' ||
            v_conn.bank_name || '. Importe um extrato novo (OFX/CSV) para manter a conciliação em dia.',
          'bank_connection',
          v_conn.id
        );
        v_alerts_created := v_alerts_created + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'stores_processed', v_stores_processed,
    'alerts_created', v_alerts_created
  );
END;
$$;

-- Sem GRANT para authenticated/anon — só é executada pelo pg_cron (role postgres).

SELECT cron.schedule(
  'connect-daily-tick',
  '0 9 * * *',
  $$SELECT public.connect_cron_tick()$$
);
