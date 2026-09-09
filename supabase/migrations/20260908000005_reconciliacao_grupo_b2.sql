-- =====================================================================
-- RECONCILIAÇÃO — GRUPO B2: df7d9286 e 4f822089
-- Ambas têm uma perna 'credit' (consumo real de loyalty_credits) E uma
-- segunda perna (pix/cash) sem vínculo com fidelidade. Por princípio de
-- menor invasão, ajusta a perna NÃO-credit, evitando mexer no saldo de
-- fidelidade do cliente quando existe alternativa igualmente válida.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _grupo_b2_snapshot ON COMMIT DROP AS
SELECT s.id AS sale_id, s.store_id, s.net_total,
       round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) AS drift
FROM public.sales s
WHERE s.id IN ('df7d9286-1540-4dcb-9a5f-ff80182ee180', '4f822089-4bc6-4e0f-9436-e2a69dc164c0')
  AND s.deleted_at IS NULL
  AND round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) > 0.001;

UPDATE public.payments p
SET amount = p.amount - t.drift
FROM _grupo_b2_snapshot t
WHERE p.sale_id = t.sale_id AND p.method <> 'credit' AND p.method <> 'pending';

UPDATE public.cash_entries ce
SET amount = ce.amount - t.drift
FROM _grupo_b2_snapshot t
WHERE ce.reference_type = 'sale' AND ce.reference_id = t.sale_id;

UPDATE public.sales s
SET amount_paid = s.net_total
FROM _grupo_b2_snapshot t
WHERE s.id = t.sale_id;

INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
SELECT t.store_id, NULL, 'reconciliacao_grupo_b2', 'sale', t.sale_id,
  jsonb_build_object('drift', t.drift), jsonb_build_object('amount_paid_after', t.net_total)
FROM _grupo_b2_snapshot t;

DO $$
DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining FROM public.sales
   WHERE id IN ('df7d9286-1540-4dcb-9a5f-ff80182ee180', '4f822089-4bc6-4e0f-9436-e2a69dc164c0')
     AND round((amount_paid + amount_pending - net_total)::numeric, 2) > 0.001;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Grupo B2: % venda(s) ainda com drift — abortando.', v_remaining;
  END IF;
END $$;

COMMIT;
