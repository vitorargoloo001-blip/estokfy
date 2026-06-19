-- =====================================================================
-- Trocas v2: registro permanente (produto antigo x novo), troco vs crédito,
-- troca avulsa (sem venda), e base para relatório de Trocas & Devoluções.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  customer_id uuid,
  return_id uuid,
  new_sale_id uuid,
  original_product_id uuid,
  original_product_name text,
  original_qty numeric DEFAULT 0,
  original_value numeric DEFAULT 0,
  new_product_id uuid,
  new_product_name text,
  new_qty numeric DEFAULT 0,
  new_value numeric DEFAULT 0,
  difference numeric DEFAULT 0,         -- new_value - original_value (assinado)
  settlement text NOT NULL DEFAULT 'zero',  -- a_pagar | troco | credito | zero
  amount_to_pay numeric DEFAULT 0,
  troco_amount numeric DEFAULT 0,
  credit_amount numeric DEFAULT 0,
  is_avulsa boolean NOT NULL DEFAULT false,
  reason text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exchanges_store ON public.exchanges(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exchanges_customer ON public.exchanges(store_id, customer_id);
ALTER TABLE public.exchanges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exchanges_select ON public.exchanges;
CREATE POLICY exchanges_select ON public.exchanges FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());

-- Substitui a versão anterior (assinatura nova com p_surplus_mode + p_is_avulsa)
DROP FUNCTION IF EXISTS public.process_exchange_atomic(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text);

CREATE OR REPLACE FUNCTION public.process_exchange_atomic(
  p_store_id uuid,
  p_sale_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_return_items jsonb,
  p_new_items jsonb,
  p_payments jsonb DEFAULT '[]'::jsonb,
  p_delivery jsonb DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_surplus_mode text DEFAULT 'credit',   -- 'credit' (saldo credor) | 'cash' (devolver troco)
  p_is_avulsa boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_customer uuid := p_customer_id;
  v_return jsonb;
  v_return_value numeric := 0;
  v_credit_id uuid;
  v_new_sale_id uuid;
  v_new_gross numeric := 0;
  v_credit_apply numeric := 0;
  v_surplus numeric := 0;
  v_to_pay numeric := 0;
  v_consume numeric := 0;
  v_troco numeric := 0;
  v_credit_left numeric := 0;
  v_settlement text := 'zero';
  v_is_avulsa boolean := COALESCE(p_is_avulsa, false) OR (p_sale_id IS NULL);
  v_orig_names text; v_orig_first uuid; v_orig_qty numeric := 0;
  v_new_names text; v_new_first uuid; v_new_qty numeric := 0;
  v_exchange_id uuid := gen_random_uuid();
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  IF v_ctx.store_id <> p_store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;

  IF v_customer IS NULL AND p_sale_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer FROM public.sales WHERE id = p_sale_id AND store_id = p_store_id;
  END IF;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_troca'; END IF;
  IF p_return_items IS NULL OR jsonb_array_length(p_return_items) = 0 THEN RAISE EXCEPTION 'sem_item_devolvido'; END IF;
  IF p_new_items IS NULL OR jsonb_array_length(p_new_items) = 0 THEN RAISE EXCEPTION 'sem_itens_novos'; END IF;

  -- 1) Devolução -> gera crédito (reusa rotina testada), depois marca origem 'troca'
  v_return := public.process_return_with_credit(
    p_store_id, p_sale_id, v_customer, p_reason, p_return_items, p_notes, 'credit'
  );
  v_return_value := COALESCE((v_return->>'total_refund')::numeric, 0);
  v_credit_id := NULLIF(v_return->>'credit_id','')::uuid;
  IF v_credit_id IS NOT NULL THEN
    UPDATE public.loyalty_credits SET origin = 'troca', reason = 'Crédito de troca' WHERE id = v_credit_id;
  END IF;

  -- 2) Nomes/valores dos produtos (para registro permanente)
  SELECT string_agg(pr.name, ', '), (array_agg(pr.id))[1], COALESCE(SUM((ri->>'qty')::numeric),0)
    INTO v_orig_names, v_orig_first, v_orig_qty
    FROM jsonb_array_elements(p_return_items) ri
    JOIN public.products pr ON pr.id = (ri->>'product_id')::uuid AND pr.store_id = p_store_id;

  SELECT string_agg(pr.name, ', '), (array_agg(pr.id))[1], COALESCE(SUM((ni->>'qty')::numeric),0),
         COALESCE(SUM(COALESCE(NULLIF(ni->>'unit_price','')::numeric, pr.sale_price) * (ni->>'qty')::int),0)
    INTO v_new_names, v_new_first, v_new_qty, v_new_gross
    FROM jsonb_array_elements(p_new_items) ni
    JOIN public.products pr ON pr.id = (ni->>'product_id')::uuid AND pr.store_id = p_store_id AND pr.is_active = true;
  IF v_new_first IS NULL THEN RAISE EXCEPTION 'produto_invalido'; END IF;

  v_credit_apply := LEAST(v_return_value, v_new_gross);
  v_surplus := GREATEST(v_return_value - v_new_gross, 0);
  v_to_pay := GREATEST(v_new_gross - v_return_value, 0);

  -- 3) Cria a venda do novo produto: crédito como desconto; diferença via p_payments
  v_new_sale_id := public.create_sale_atomic(
    p_store_id, v_customer, p_new_items, COALESCE(p_payments, '[]'::jsonb),
    COALESCE(p_delivery, jsonb_build_object('method','pickup','shipping_fee',0,'delivery_cost',0)),
    v_credit_apply, NULL, NULL, COALESCE(p_notes, 'Troca')
  );

  -- 4) Saldo positivo para o cliente: troco em dinheiro OU mantém como crédito
  v_consume := v_credit_apply;
  IF v_surplus > 0 THEN
    IF p_surplus_mode = 'cash' THEN
      INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
      SELECT p_store_id, l.id, 'expense', 'troco', v_surplus, 'exchange', v_new_sale_id, 'Troco de troca', v_ctx.profile_id
      FROM public.cash_ledger l WHERE l.store_id = p_store_id AND l.is_default = true LIMIT 1;
      v_consume := v_consume + v_surplus;
      v_troco := v_surplus;
    ELSE
      v_credit_left := v_surplus;
    END IF;
  END IF;

  -- 5) Consome o crédito da troca (desconto na venda + eventual troco)
  IF v_consume > 0 AND v_credit_id IS NOT NULL THEN
    UPDATE public.loyalty_credits
       SET amount_used = amount_used + v_consume,
           status = CASE WHEN (amount_generated - (amount_used + v_consume)) <= 0 THEN 'used' ELSE 'partially_used' END
     WHERE id = v_credit_id;
    INSERT INTO public.loyalty_credit_uses(store_id, credit_id, customer_id, sale_id, amount_applied)
    VALUES (p_store_id, v_credit_id, v_customer, v_new_sale_id, v_consume);
  END IF;

  v_settlement := CASE
    WHEN v_to_pay > 0 THEN 'a_pagar'
    WHEN v_troco > 0 THEN 'troco'
    WHEN v_credit_left > 0 THEN 'credito'
    ELSE 'zero' END;

  -- 6) Registro permanente da troca (para histórico do cliente e relatórios)
  INSERT INTO public.exchanges(
    id, store_id, customer_id, return_id, new_sale_id,
    original_product_id, original_product_name, original_qty, original_value,
    new_product_id, new_product_name, new_qty, new_value,
    difference, settlement, amount_to_pay, troco_amount, credit_amount,
    is_avulsa, reason, notes, created_by
  ) VALUES (
    v_exchange_id, p_store_id, v_customer, NULLIF(v_return->>'return_id','')::uuid, v_new_sale_id,
    v_orig_first, v_orig_names, v_orig_qty, v_return_value,
    v_new_first, v_new_names, v_new_qty, v_new_gross,
    v_new_gross - v_return_value, v_settlement, v_to_pay, v_troco, v_credit_left,
    v_is_avulsa, p_reason, p_notes, v_ctx.profile_id
  );

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'create', 'exchange', v_exchange_id,
    jsonb_build_object('return_id', v_return->>'return_id', 'new_sale_id', v_new_sale_id,
      'original', v_orig_names, 'novo', v_new_names, 'original_value', v_return_value, 'new_value', v_new_gross,
      'settlement', v_settlement, 'a_pagar', v_to_pay, 'troco', v_troco, 'credito', v_credit_left, 'avulsa', v_is_avulsa));

  RETURN jsonb_build_object(
    'exchange_id', v_exchange_id,
    'return_id', v_return->>'return_id',
    'new_sale_id', v_new_sale_id,
    'original_value', v_return_value,
    'new_value', v_new_gross,
    'difference', v_new_gross - v_return_value,
    'settlement', v_settlement,
    'amount_to_pay', v_to_pay,
    'troco', v_troco,
    'credit_left', v_credit_left
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_exchange_atomic(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,boolean) TO authenticated;
