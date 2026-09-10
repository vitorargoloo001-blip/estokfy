-- =====================================================================
-- get_fiscal_summary: leitura robusta de alert_days
--
-- store_settings.settings é jsonb livre e agora é editável pela tela
-- (Configurações → Fiscal), que grava o campo como TEXTO. A versão
-- anterior fazia (settings->>'alert_days')::int direto: bastava alguém
-- digitar "quinze", "-3" ou deixar espaço em branco para o cast estourar
-- e derrubar a RPC inteira — quebrando o card do Dashboard e a tela
-- Fiscal de uma vez.
--
-- Regra agora: só aceita inteiro positivo. Qualquer outra coisa (texto,
-- vazio, zero, negativo, decimal) cai no padrão de 15 dias, que é o
-- mesmo padrão declarado no frontend em FISCAL_ALERT_DAYS_DEFAULT.
-- Nada além dessa leitura mudou em relação à versão anterior.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_fiscal_summary(
  p_store_id uuid,
  p_year int DEFAULT NULL,
  p_month int DEFAULT NULL
) RETURNS TABLE (
  pending_count bigint,
  sent_count bigint,
  declared_count bigint,
  cancelled_count bigint,
  period_count bigint,
  pending_amount numeric,
  overdue_count bigint,
  alert_days int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
  v_alert_days int := 15;
BEGIN
  PERFORM public._assert_fiscal_manage(p_store_id);

  SELECT btrim(ss.settings->>'alert_days') INTO v_raw
    FROM public.store_settings ss
   WHERE ss.store_id = p_store_id AND ss.category = 'fiscal';

  -- só dígitos, e o valor precisa ser >= 1; o limite superior evita que
  -- um número absurdo desative o alerta silenciosamente
  IF v_raw ~ '^[0-9]+$' AND v_raw::numeric BETWEEN 1 AND 3650 THEN
    v_alert_days := v_raw::int;
  END IF;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE fd.fiscal_status = 'pending'),
    count(*) FILTER (WHERE fd.fiscal_status = 'sent_to_accountant'),
    count(*) FILTER (WHERE fd.fiscal_status = 'declared'),
    count(*) FILTER (WHERE fd.fiscal_status = 'cancelled'),
    count(*) FILTER (
      WHERE (p_year IS NULL OR fd.competence_year = p_year)
        AND (p_month IS NULL OR fd.competence_month = p_month)
    ),
    COALESCE(sum(fd.total_amount) FILTER (WHERE fd.fiscal_status = 'pending'), 0)::numeric,
    count(*) FILTER (
      WHERE fd.fiscal_status = 'pending'
        AND fd.issue_date < (current_date - v_alert_days)
    ),
    v_alert_days
  FROM public.fiscal_documents fd
  WHERE fd.store_id = p_store_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_fiscal_summary(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fiscal_summary(uuid, int, int) TO authenticated;
