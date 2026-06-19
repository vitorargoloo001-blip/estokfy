-- =======================================================
-- PROGRAMA DE FIDELIDADE
-- =======================================================

-- 1) TABELAS
CREATE TABLE IF NOT EXISTS public.loyalty_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  amount_generated numeric(12,2) NOT NULL DEFAULT 0,
  amount_used numeric(12,2) NOT NULL DEFAULT 0,
  amount_available numeric(12,2) GENERATED ALWAYS AS (GREATEST(amount_generated - amount_used, 0)) STORED,
  reason text NOT NULL DEFAULT 'Premiação por meta de compras',
  status text NOT NULL DEFAULT 'available', -- available | partially_used | used | cancelled | expired
  source_sale_id uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lc_store_customer ON public.loyalty_credits(store_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_lc_status ON public.loyalty_credits(store_id, status);

CREATE TABLE IF NOT EXISTS public.loyalty_credit_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  credit_id uuid NOT NULL REFERENCES public.loyalty_credits(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  amount_applied numeric(12,2) NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lcu_sale ON public.loyalty_credit_uses(sale_id);
CREATE INDEX IF NOT EXISTS idx_lcu_credit ON public.loyalty_credit_uses(credit_id);

ALTER TABLE public.loyalty_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_credit_uses ENABLE ROW LEVEL SECURITY;

CREATE POLICY lc_select ON public.loyalty_credits FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());
CREATE POLICY lcu_select ON public.loyalty_credit_uses FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());
-- Sem políticas de INSERT/UPDATE: só via RPC SECURITY DEFINER.

-- 2) SETTINGS HELPER
CREATE OR REPLACE FUNCTION public.get_loyalty_settings()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v jsonb;
BEGIN
  IF v_store IS NULL THEN
    RETURN jsonb_build_object('enabled', true, 'goal_amount', 1000, 'credit_amount', 80, 'count_paid_only', true);
  END IF;
  SELECT settings INTO v
    FROM public.store_settings
   WHERE store_id = v_store AND category = 'loyalty'
   LIMIT 1;
  RETURN COALESCE(v, jsonb_build_object('enabled', true, 'goal_amount', 1000, 'credit_amount', 80, 'count_paid_only', true));
END;
$$;

-- Helper sem RLS para leitura por store_id (uso interno em triggers)
CREATE OR REPLACE FUNCTION public.get_loyalty_settings_for_store(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  SELECT settings INTO v FROM public.store_settings WHERE store_id = p_store_id AND category = 'loyalty' LIMIT 1;
  RETURN COALESCE(v, jsonb_build_object('enabled', true, 'goal_amount', 1000, 'credit_amount', 80, 'count_paid_only', true));
END;
$$;

-- 3) CÁLCULO DO CLIENTE
-- Total elegível = soma de amount_paid das vendas pagas/parciais
--                  - reembolsos de devoluções (return_items.refund_amount)
CREATE OR REPLACE FUNCTION public.customer_loyalty_summary(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_settings jsonb := public.get_loyalty_settings();
  v_goal numeric := COALESCE((v_settings->>'goal_amount')::numeric, 1000);
  v_credit numeric := COALESCE((v_settings->>'credit_amount')::numeric, 80);
  v_total_paid numeric := 0;
  v_total_refunded numeric := 0;
  v_eligible numeric := 0;
  v_milestones int := 0;
  v_progress numeric := 0;
  v_remaining numeric := 0;
  v_credits_generated numeric := 0;
  v_credits_used numeric := 0;
  v_credits_available numeric := 0;
  v_status text;
BEGIN
  -- amount_paid descontando o que já foi usado de crédito (não conta como gasto novo)
  SELECT COALESCE(SUM(s.amount_paid),0)
    INTO v_total_paid
   FROM public.sales s
   WHERE s.store_id = v_store
     AND s.customer_id = p_customer_id;

  -- refund de devoluções
  SELECT COALESCE(SUM(ri.refund_amount),0)
    INTO v_total_refunded
   FROM public.returns r
   JOIN public.return_items ri ON ri.return_id = r.id
   JOIN public.sales s ON s.id = r.sale_id
   WHERE r.store_id = v_store
     AND s.customer_id = p_customer_id;

  -- desconta créditos já usados (eles não devem gerar novo crédito)
  SELECT COALESCE(SUM(lcu.amount_applied),0)
    INTO v_credits_used
   FROM public.loyalty_credit_uses lcu
   WHERE lcu.store_id = v_store
     AND lcu.customer_id = p_customer_id
     AND lcu.reverted_at IS NULL;

  v_eligible := GREATEST(v_total_paid - v_total_refunded - v_credits_used, 0);

  IF v_goal > 0 THEN
    v_milestones := FLOOR(v_eligible / v_goal)::int;
    v_progress := v_eligible - (v_milestones * v_goal);
    v_remaining := GREATEST(v_goal - v_progress, 0);
  END IF;

  SELECT COALESCE(SUM(amount_generated),0)
    INTO v_credits_generated
   FROM public.loyalty_credits
   WHERE store_id = v_store AND customer_id = p_customer_id AND status <> 'cancelled';

  SELECT COALESCE(SUM(amount_available),0)
    INTO v_credits_available
   FROM public.loyalty_credits
   WHERE store_id = v_store AND customer_id = p_customer_id
     AND status IN ('available','partially_used');

  v_status := CASE
    WHEN v_credits_available > 0 THEN 'credit_available'
    WHEN v_milestones > 0 AND v_credits_available = 0 THEN 'credit_used'
    WHEN v_remaining <= (v_goal * 0.2) AND v_eligible > 0 THEN 'near_goal'
    WHEN v_milestones > 0 THEN 'goal_reached'
    ELSE 'in_progress'
  END;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'goal_amount', v_goal,
    'credit_amount', v_credit,
    'total_paid', v_total_paid,
    'total_refunded', v_total_refunded,
    'total_eligible', v_eligible,
    'milestones_reached', v_milestones,
    'current_progress', v_progress,
    'remaining_to_next', v_remaining,
    'credits_generated_total', v_credits_generated,
    'credits_used_total', v_credits_used,
    'credits_available', v_credits_available,
    'status', v_status
  );
END;
$$;

-- 4) RANKING
CREATE OR REPLACE FUNCTION public.loyalty_ranking()
RETURNS TABLE(
  customer_id uuid,
  customer_name text,
  customer_phone text,
  total_eligible numeric,
  current_progress numeric,
  remaining_to_next numeric,
  milestones_reached int,
  credits_generated_total numeric,
  credits_used_total numeric,
  credits_available numeric,
  status text,
  goal_amount numeric,
  credit_amount numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_settings jsonb := public.get_loyalty_settings();
  v_goal numeric := COALESCE((v_settings->>'goal_amount')::numeric, 1000);
  v_credit numeric := COALESCE((v_settings->>'credit_amount')::numeric, 80);
BEGIN
  IF v_store IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH paid AS (
    SELECT s.customer_id AS cid, SUM(s.amount_paid)::numeric AS total_paid
    FROM public.sales s
    WHERE s.store_id = v_store AND s.customer_id IS NOT NULL
    GROUP BY s.customer_id
  ),
  refunded AS (
    SELECT s.customer_id AS cid, SUM(ri.refund_amount)::numeric AS total_refunded
    FROM public.returns r
    JOIN public.return_items ri ON ri.return_id = r.id
    JOIN public.sales s ON s.id = r.sale_id
    WHERE r.store_id = v_store AND s.customer_id IS NOT NULL
    GROUP BY s.customer_id
  ),
  used AS (
    SELECT lcu.customer_id AS cid, SUM(lcu.amount_applied)::numeric AS total_used
    FROM public.loyalty_credit_uses lcu
    WHERE lcu.store_id = v_store AND lcu.reverted_at IS NULL
    GROUP BY lcu.customer_id
  ),
  generated AS (
    SELECT lc.customer_id AS cid,
           SUM(CASE WHEN lc.status <> 'cancelled' THEN lc.amount_generated ELSE 0 END)::numeric AS gen_total,
           SUM(CASE WHEN lc.status IN ('available','partially_used') THEN lc.amount_available ELSE 0 END)::numeric AS avail
    FROM public.loyalty_credits lc
    WHERE lc.store_id = v_store
    GROUP BY lc.customer_id
  )
  SELECT
    c.id,
    c.name,
    c.phone,
    GREATEST(COALESCE(p.total_paid,0) - COALESCE(rf.total_refunded,0) - COALESCE(u.total_used,0), 0) AS total_eligible,
    CASE WHEN v_goal > 0
      THEN GREATEST(COALESCE(p.total_paid,0) - COALESCE(rf.total_refunded,0) - COALESCE(u.total_used,0), 0)
           - FLOOR(GREATEST(COALESCE(p.total_paid,0) - COALESCE(rf.total_refunded,0) - COALESCE(u.total_used,0), 0) / v_goal) * v_goal
      ELSE 0 END AS current_progress,
    CASE WHEN v_goal > 0
      THEN GREATEST(v_goal - (
        GREATEST(COALESCE(p.total_paid,0) - COALESCE(rf.total_refunded,0) - COALESCE(u.total_used,0), 0)
        - FLOOR(GREATEST(COALESCE(p.total_paid,0) - COALESCE(rf.total_refunded,0) - COALESCE(u.total_used,0), 0) / v_goal) * v_goal
      ), 0)
      ELSE 0 END AS remaining_to_next,
    CASE WHEN v_goal > 0
      THEN FLOOR(GREATEST(COALESCE(p.total_paid,0) - COALESCE(rf.total_refunded,0) - COALESCE(u.total_used,0), 0) / v_goal)::int
      ELSE 0 END AS milestones_reached,
    COALESCE(g.gen_total,0),
    COALESCE(u.total_used,0),
    COALESCE(g.avail,0),
    CASE
      WHEN COALESCE(g.avail,0) > 0 THEN 'credit_available'
      WHEN COALESCE(g.gen_total,0) > 0 THEN 'credit_used'
      WHEN v_goal > 0 AND (
        v_goal - (GREATEST(COALESCE(p.total_paid,0)-COALESCE(rf.total_refunded,0)-COALESCE(u.total_used,0),0) -
        FLOOR(GREATEST(COALESCE(p.total_paid,0)-COALESCE(rf.total_refunded,0)-COALESCE(u.total_used,0),0)/v_goal)*v_goal)
      ) <= (v_goal * 0.2) AND COALESCE(p.total_paid,0) > 0 THEN 'near_goal'
      ELSE 'in_progress'
    END,
    v_goal,
    v_credit
  FROM public.customers c
  LEFT JOIN paid p     ON p.cid  = c.id
  LEFT JOIN refunded rf ON rf.cid = c.id
  LEFT JOIN used u     ON u.cid  = c.id
  LEFT JOIN generated g ON g.cid  = c.id
  WHERE c.store_id = v_store
  ORDER BY total_eligible DESC, c.name ASC;
END;
$$;

-- 5) RECÁLCULO DE CRÉDITOS
CREATE OR REPLACE FUNCTION public.recalc_loyalty_for_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store uuid;
  v_settings jsonb;
  v_enabled boolean;
  v_goal numeric;
  v_credit_amt numeric;
  v_total_paid numeric := 0;
  v_total_refunded numeric := 0;
  v_credits_used numeric := 0;
  v_eligible numeric := 0;
  v_target_milestones int := 0;
  v_existing_active int := 0;
  v_to_create int := 0;
  v_to_cancel int := 0;
  v_created int := 0;
  v_cancelled int := 0;
  i int;
BEGIN
  SELECT store_id INTO v_store FROM public.customers WHERE id = p_customer_id;
  IF v_store IS NULL THEN RETURN jsonb_build_object('ok', false, 'error','customer_not_found'); END IF;

  v_settings := public.get_loyalty_settings_for_store(v_store);
  v_enabled := COALESCE((v_settings->>'enabled')::boolean, true);
  v_goal := COALESCE((v_settings->>'goal_amount')::numeric, 1000);
  v_credit_amt := COALESCE((v_settings->>'credit_amount')::numeric, 80);

  IF NOT v_enabled OR v_goal <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  SELECT COALESCE(SUM(amount_paid),0) INTO v_total_paid
    FROM public.sales WHERE store_id = v_store AND customer_id = p_customer_id;

  SELECT COALESCE(SUM(ri.refund_amount),0) INTO v_total_refunded
    FROM public.returns r
    JOIN public.return_items ri ON ri.return_id = r.id
    JOIN public.sales s ON s.id = r.sale_id
    WHERE r.store_id = v_store AND s.customer_id = p_customer_id;

  SELECT COALESCE(SUM(amount_applied),0) INTO v_credits_used
    FROM public.loyalty_credit_uses
    WHERE store_id = v_store AND customer_id = p_customer_id AND reverted_at IS NULL;

  v_eligible := GREATEST(v_total_paid - v_total_refunded - v_credits_used, 0);
  v_target_milestones := FLOOR(v_eligible / v_goal)::int;

  SELECT COUNT(*) INTO v_existing_active
    FROM public.loyalty_credits
    WHERE store_id = v_store AND customer_id = p_customer_id
      AND status IN ('available','partially_used','used');

  IF v_target_milestones > v_existing_active THEN
    v_to_create := v_target_milestones - v_existing_active;
    FOR i IN 1..v_to_create LOOP
      INSERT INTO public.loyalty_credits(store_id, customer_id, amount_generated, reason, status)
      VALUES (v_store, p_customer_id, v_credit_amt,
        'Premiação automática por R$ '||v_goal::text||' em compras pagas', 'available');
      v_created := v_created + 1;
    END LOOP;
  ELSIF v_target_milestones < v_existing_active THEN
    -- Cancela créditos NÃO USADOS mais recentes para retornar ao alvo
    v_to_cancel := v_existing_active - v_target_milestones;
    WITH to_cancel AS (
      SELECT id FROM public.loyalty_credits
       WHERE store_id = v_store AND customer_id = p_customer_id
         AND status = 'available' AND amount_used = 0
       ORDER BY generated_at DESC
       LIMIT v_to_cancel
    )
    UPDATE public.loyalty_credits
       SET status='cancelled', cancelled_at=now()
     WHERE id IN (SELECT id FROM to_cancel);
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'eligible', v_eligible,
    'target_milestones', v_target_milestones,
    'existing_active', v_existing_active,
    'created', v_created,
    'cancelled', v_cancelled
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_loyalty_for_store()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_count int := 0;
  v_cust record;
BEGIN
  IF v_store IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  FOR v_cust IN SELECT id FROM public.customers WHERE store_id = v_store LOOP
    PERFORM public.recalc_loyalty_for_customer(v_cust.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'customers_processed', v_count);
END;
$$;

-- 6) USAR CRÉDITO EM VENDA (parcial, FIFO)
CREATE OR REPLACE FUNCTION public.use_loyalty_credit_atomic(p_sale_id uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_sale record;
  v_settings jsonb;
  v_enabled boolean;
  v_remaining numeric;
  v_credit record;
  v_apply numeric;
  v_total_applied numeric := 0;
  v_max_applicable numeric;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'venda_nao_encontrada'; END IF;
  IF v_sale.store_id <> v_ctx.store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_sale.customer_id IS NULL THEN RAISE EXCEPTION 'venda_sem_cliente'; END IF;

  v_settings := public.get_loyalty_settings_for_store(v_sale.store_id);
  v_enabled := COALESCE((v_settings->>'enabled')::boolean, true);
  IF NOT v_enabled THEN RAISE EXCEPTION 'programa_desabilitado'; END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'valor_invalido'; END IF;

  -- não pode passar do total da venda (gross_total - já aplicado)
  SELECT COALESCE(SUM(amount_applied),0) INTO v_total_applied
    FROM public.loyalty_credit_uses
    WHERE sale_id = p_sale_id AND reverted_at IS NULL;

  v_max_applicable := GREATEST(v_sale.gross_total - v_total_applied, 0);
  IF p_amount > v_max_applicable THEN
    RAISE EXCEPTION 'credito_excede_total_venda';
  END IF;

  v_remaining := p_amount;

  FOR v_credit IN
    SELECT * FROM public.loyalty_credits
     WHERE store_id = v_sale.store_id
       AND customer_id = v_sale.customer_id
       AND status IN ('available','partially_used')
       AND amount_available > 0
     ORDER BY generated_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_apply := LEAST(v_credit.amount_available, v_remaining);

    UPDATE public.loyalty_credits
       SET amount_used = amount_used + v_apply,
           status = CASE
             WHEN (amount_generated - (amount_used + v_apply)) <= 0 THEN 'used'
             ELSE 'partially_used'
           END
     WHERE id = v_credit.id;

    INSERT INTO public.loyalty_credit_uses(store_id, credit_id, customer_id, sale_id, amount_applied)
    VALUES (v_sale.store_id, v_credit.id, v_sale.customer_id, p_sale_id, v_apply);

    v_remaining := v_remaining - v_apply;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'credito_insuficiente';
  END IF;

  -- aplica desconto na venda: aumenta discount_total e recalcula net/profit
  UPDATE public.sales
     SET discount_total = discount_total + p_amount,
         net_total = GREATEST(gross_total - (discount_total + p_amount) + shipping_fee, 0),
         profit_gross = GREATEST(gross_total - (discount_total + p_amount) + shipping_fee, 0) - cost_total
   WHERE id = p_sale_id;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (v_sale.store_id, v_ctx.profile_id, 'loyalty_credit_used', 'sale', p_sale_id,
    jsonb_build_object('amount', p_amount));

  RETURN jsonb_build_object('ok', true, 'amount_applied', p_amount);
END;
$$;

-- 7) REVERTER USOS DE CRÉDITO PARA UMA VENDA
CREATE OR REPLACE FUNCTION public.revert_loyalty_credit_uses_for_sale(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_use record;
  v_total numeric := 0;
BEGIN
  FOR v_use IN
    SELECT * FROM public.loyalty_credit_uses
     WHERE sale_id = p_sale_id AND reverted_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE public.loyalty_credits
       SET amount_used = GREATEST(amount_used - v_use.amount_applied, 0),
           status = CASE
             WHEN GREATEST(amount_used - v_use.amount_applied, 0) <= 0 THEN 'available'
             WHEN GREATEST(amount_used - v_use.amount_applied, 0) < amount_generated THEN 'partially_used'
             ELSE status
           END
     WHERE id = v_use.credit_id;
    UPDATE public.loyalty_credit_uses SET reverted_at = now() WHERE id = v_use.id;
    v_total := v_total + v_use.amount_applied;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'reverted_total', v_total);
END;
$$;

-- 8) TRIGGERS para recalcular automaticamente
CREATE OR REPLACE FUNCTION public.trg_sales_loyalty_recalc()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.customer_id IS NOT NULL AND (
      OLD.amount_paid IS DISTINCT FROM NEW.amount_paid OR
      OLD.payment_status IS DISTINCT FROM NEW.payment_status
    ) THEN
      PERFORM public.recalc_loyalty_for_customer(NEW.customer_id);
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.customer_id IS NOT NULL AND NEW.amount_paid > 0 THEN
      PERFORM public.recalc_loyalty_for_customer(NEW.customer_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sales_loyalty_recalc ON public.sales;
CREATE TRIGGER sales_loyalty_recalc
  AFTER INSERT OR UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_loyalty_recalc();

CREATE OR REPLACE FUNCTION public.trg_returns_loyalty_recalc()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_cid uuid;
BEGIN
  SELECT s.customer_id INTO v_cid FROM public.returns r
    JOIN public.sales s ON s.id = r.sale_id
   WHERE r.id = NEW.return_id;
  IF v_cid IS NOT NULL THEN
    PERFORM public.recalc_loyalty_for_customer(v_cid);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS return_items_loyalty_recalc ON public.return_items;
CREATE TRIGGER return_items_loyalty_recalc
  AFTER INSERT ON public.return_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_returns_loyalty_recalc();

-- 9) DEFAULT SETTINGS para todas lojas existentes
INSERT INTO public.store_settings(store_id, category, settings)
SELECT s.id, 'loyalty', jsonb_build_object(
  'enabled', true, 'goal_amount', 1000, 'credit_amount', 80, 'count_paid_only', true
)
FROM public.stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_settings ss WHERE ss.store_id = s.id AND ss.category = 'loyalty'
);

-- 10) RECÁLCULO RETROATIVO PARA TODA A BASE
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM public.customers LOOP
    BEGIN
      PERFORM public.recalc_loyalty_for_customer(c.id);
    EXCEPTION WHEN OTHERS THEN
      -- ignora erro pontual de cliente
      NULL;
    END;
  END LOOP;
END $$;

-- 11) Atualiza bootstrap_new_store para incluir 'loyalty' nas novas lojas
CREATE OR REPLACE FUNCTION public.bootstrap_new_store(p_auth_user_id uuid, p_store_name text DEFAULT 'Minha Loja'::text, p_full_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store_id uuid;
  v_profile_id uuid;
  v_ledger_id uuid;
  v_user_email text;
BEGIN
  SELECT store_id INTO v_store_id FROM public.profiles WHERE auth_user_id = p_auth_user_id LIMIT 1;
  IF v_store_id IS NOT NULL THEN
    RETURN v_store_id;
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = p_auth_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'usuario_nao_encontrado';
  END IF;

  v_store_id := gen_random_uuid();
  v_profile_id := gen_random_uuid();
  v_ledger_id := gen_random_uuid();

  INSERT INTO public.stores (id, name, email, primary_color, secondary_color, access_enabled, subscription_status)
  VALUES (v_store_id, p_store_name, v_user_email, '#3B82F6', '#1E40AF', false, 'pending_payment');

  INSERT INTO public.profiles (id, store_id, auth_user_id, role, is_active, full_name)
  VALUES (v_profile_id, v_store_id, p_auth_user_id, 'owner', true, p_full_name);

  INSERT INTO public.cash_ledger (id, store_id, name, is_default, currency)
  VALUES (v_ledger_id, v_store_id, 'Caixa Principal', true, 'BRL');

  INSERT INTO public.categories (store_id, name, color, sort_order) VALUES
    (v_store_id, 'Telas', '#3B82F6', 1),(v_store_id,'Baterias','#EF4444',2),(v_store_id,'Conectores','#8B5CF6',3),
    (v_store_id, 'Tampas','#6B7280',4),(v_store_id,'Câmeras','#10B981',5),(v_store_id,'Flex','#F59E0B',6),
    (v_store_id,'Carcaças','#6366F1',7),(v_store_id,'Alto-falantes','#EC4899',8),(v_store_id,'Microfones','#14B8A6',9),
    (v_store_id,'Acessórios','#F97316',10),(v_store_id,'Ferramentas','#78716C',11),(v_store_id,'Outros','#9CA3AF',12);

  INSERT INTO public.store_settings (store_id, category, settings, updated_by) VALUES
    (v_store_id, 'preferences', jsonb_build_object('theme','light','language','pt-BR','currency','BRL','date_format','dd/MM/yyyy','timezone','America/Sao_Paulo','pagination',20,'quick_mode',true,'sounds',false,'animations',true), v_profile_id),
    (v_store_id, 'sales', jsonb_build_object('require_customer',false,'require_payment',true,'allow_discount',true,'max_discount_pct',100,'default_payment','pix','print_receipt',false), v_profile_id),
    (v_store_id, 'inventory', jsonb_build_object('track_minimum',true,'default_minimum',5,'negative_stock',false,'auto_deduct_on_sale',true,'restock_on_return',true,'low_stock_alert',true), v_profile_id),
    (v_store_id, 'finance', jsonb_build_object('categories_income','["Venda de produto","Ajuste de caixa","Reembolso","Outros recebimentos"]'::jsonb,'categories_expense','["Compra de mercadoria","Aluguel","Energia","Internet","Funcionários","Transporte","Marketing","Impostos","Manutenção","Outros"]'::jsonb), v_profile_id),
    (v_store_id, 'shipping', jsonb_build_object('methods','["pickup","correios","motoboy","transportadora","app_delivery"]'::jsonb,'default_method','pickup','track_cost',true), v_profile_id),
    (v_store_id, 'returns', jsonb_build_object('allow_returns',true,'require_reason',true,'auto_restock',false,'require_sale_link',false), v_profile_id),
    (v_store_id, 'notifications', jsonb_build_object('low_stock',true,'new_sale',false,'delivery_update',false,'email_notifications',false), v_profile_id),
    (v_store_id, 'ai', jsonb_build_object('enabled',true,'assistant_name','Assistente','welcome_message','Olá! Sou seu assistente do sistema.','contextual_help',true,'quick_suggestions',true), v_profile_id),
    (v_store_id, 'security', jsonb_build_object('audit_enabled',true,'session_timeout',480), v_profile_id),
    (v_store_id, 'loyalty', jsonb_build_object('enabled',true,'goal_amount',1000,'credit_amount',80,'count_paid_only',true), v_profile_id);

  INSERT INTO public.payment_verifications (store_id, user_id, email, plan_id, expected_amount)
  VALUES (v_store_id, p_auth_user_id, v_user_email, 'basic', 49.90);

  INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (v_store_id, v_profile_id, 'bootstrap', 'store', v_store_id,
    jsonb_build_object('event','store_bootstrapped'));

  RETURN v_store_id;
END;
$function$;